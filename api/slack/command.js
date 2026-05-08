import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

function verify(req, body) {
  const ts = req.headers['x-slack-request-timestamp'];
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${ts}:${body}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.headers['x-slack-signature']));
}

// Format helpers
function progressBar(pct, len = 10) {
  const filled = Math.round((pct / 100) * len);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(len - filled);
}

function fmtDate(d) {
  if (!d) return '-';
  return d.slice(5).replace('-', '/');
}

function fmtRevenue(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return String(n);
}

async function handleCommand(text, userId) {
  const [sub, ...args] = text.trim().split(/\s+/);

  if (!sub || sub === 'help') {
    return {
      response_type: 'ephemeral',
      text: [
        '*VN KPI Bot Commands*',
        '',
        '`/kpi report` - Show today\'s team progress report',
        '`/kpi my` - Show my milestones',
        '`/kpi projects` - List all projects',
        '`/kpi done <project_number> <milestone_number>` - Mark milestone as done',
        '`/kpi add <project_name> | <milestone_title> | <end_date> | <owner>` - Add milestone',
        '`/kpi help` - Show this help',
      ].join('\n'),
    };
  }

  if (sub === 'report') {
    return await buildTeamReport();
  }

  if (sub === 'projects') {
    return await listProjects();
  }

  if (sub === 'my') {
    return await myMilestones(userId);
  }

  if (sub === 'done') {
    const projIdx = parseInt(args[0]);
    const msIdx = parseInt(args[1]);
    if (isNaN(projIdx) || isNaN(msIdx)) {
      return { response_type: 'ephemeral', text: 'Usage: `/kpi done <project_number> <milestone_number>`' };
    }
    return await markDone(projIdx, msIdx);
  }

  if (sub === 'add') {
    const parts = args.join(' ').split('|').map(s => s.trim());
    if (parts.length < 2) {
      return { response_type: 'ephemeral', text: 'Usage: `/kpi add <project_name> | <milestone_title> | <end_date> | <owner>`' };
    }
    return await addMilestone(parts[0], parts[1], parts[2], parts[3]);
  }

  return { response_type: 'ephemeral', text: `Unknown command: \`${sub}\`. Try \`/kpi help\`` };
}

async function listProjects() {
  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  if (!projects || projects.length === 0) {
    return { response_type: 'ephemeral', text: 'No projects found.' };
  }

  const lines = projects.map((p, i) => {
    const tasks = p.subtasks || [];
    const done = tasks.filter(s => s.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return `*${i + 1}.* ${p.icon || ''} ${p.name} (@${p.owner || '?'}) ${progressBar(pct)} ${pct}% (${done}/${tasks.length})`;
  });

  return { response_type: 'ephemeral', text: '*Projects*\n\n' + lines.join('\n') };
}

async function myMilestones(slackUserId) {
  // lookup slack user email
  const userRes = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const userData = await userRes.json();
  const email = userData?.user?.profile?.email;

  // find profile name by email
  const { data: profile } = await sb.from('profiles').select('name').eq('email', email).single();
  const name = profile?.name || '';

  if (!name) {
    return { response_type: 'ephemeral', text: 'Could not find your profile. Make sure your Slack email matches your KPI dashboard email.' };
  }

  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];

  projects?.forEach((p, pi) => {
    const myTasks = (p.subtasks || []).filter(s =>
      (s.owner || '').includes(name) && !s.done
    );
    if (myTasks.length > 0) {
      lines.push(`\n*${pi + 1}. ${p.icon || ''} ${p.name}*`);
      myTasks.forEach((s, si) => {
        const idx = (p.subtasks || []).indexOf(s) + 1;
        const daysLeft = Math.ceil((new Date(s.end) - new Date(today)) / 86400000);
        const warn = daysLeft <= 3 ? ' :warning:' : '';
        lines.push(`  ${idx}. ${s.title} (~${fmtDate(s.end)}, D${daysLeft > 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)})${warn}`);
      });
    }
  });

  if (lines.length === 0) {
    return { response_type: 'ephemeral', text: `:tada: No pending milestones for *${name}*!` };
  }

  return { response_type: 'ephemeral', text: `:clipboard: *${name}'s pending milestones*` + lines.join('\n') };
}

async function markDone(projIdx, msIdx) {
  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  const p = projects?.[projIdx - 1];
  if (!p) return { response_type: 'ephemeral', text: `Project #${projIdx} not found.` };

  const tasks = p.subtasks || [];
  const s = tasks[msIdx - 1];
  if (!s) return { response_type: 'ephemeral', text: `Milestone #${msIdx} not found in "${p.name}".` };

  if (s.done) return { response_type: 'ephemeral', text: `"${s.title}" is already done.` };

  s.done = true;
  s.status = 'done';
  s.progress = 100;

  const { error } = await sb.from('projects').update({ subtasks: tasks }).eq('id', p.id);
  if (error) return { response_type: 'ephemeral', text: `Error: ${error.message}` };

  const done = tasks.filter(t => t.done).length;
  const pct = Math.round((done / tasks.length) * 100);

  return {
    response_type: 'in_channel',
    text: `:white_check_mark: *"${s.title}"* done! (${done}/${tasks.length})\n${p.icon || ''} *${p.name}* ${progressBar(pct)} ${pct}%`,
  };
}

async function addMilestone(projectName, title, endDate, owner) {
  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  const p = projects?.find(x => x.name.toLowerCase().includes(projectName.toLowerCase()));
  if (!p) return { response_type: 'ephemeral', text: `Project "${projectName}" not found.` };

  const today = new Date().toISOString().slice(0, 10);
  const end = endDate || p.deadline || today;
  const newTask = {
    id: crypto.randomUUID(),
    title,
    owner: owner || 'TBD',
    start: today,
    end,
    done: false,
    progress: 0,
    status: 'todo',
  };

  const tasks = p.subtasks || [];
  tasks.push(newTask);

  const { error } = await sb.from('projects').update({ subtasks: tasks }).eq('id', p.id);
  if (error) return { response_type: 'ephemeral', text: `Error: ${error.message}` };

  return {
    response_type: 'in_channel',
    text: `:sparkles: Milestone added to *${p.name}*\n"${title}" (owner: ${newTask.owner}, ~${fmtDate(end)})`,
  };
}

async function buildTeamReport() {
  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  const { data: settings } = await sb.from('settings').select('*').single();
  const { data: matches } = await sb.from('matches').select('*');

  const today = new Date().toISOString().slice(0, 10);
  const lines = [`:bar_chart: *VN KPI Daily Report* (${today})\n`];

  // Projects
  projects?.forEach(p => {
    const tasks = p.subtasks || [];
    const done = tasks.filter(s => s.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const statusEmoji = pct >= 80 ? ':large_blue_circle:' : pct >= 50 ? ':large_yellow_circle:' : ':red_circle:';

    lines.push(`${statusEmoji} *${p.icon || ''} ${p.name}* (@${p.owner || '?'}) ${progressBar(pct)} ${pct}%`);

    // Upcoming deadlines
    const upcoming = tasks.filter(s => !s.done).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    upcoming.slice(0, 2).forEach(s => {
      const daysLeft = Math.ceil((new Date(s.end) - new Date(today)) / 86400000);
      const warn = daysLeft <= 3 ? ' :warning:' : '';
      lines.push(`   :hourglass: ${s.title} (D${daysLeft > 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)})${warn}`);
    });
    lines.push('');
  });

  // Revenue
  if (settings) {
    const totalRevenue = projects?.reduce((sum, p) => sum + (p.actual_revenue || 0), 0) || 0;
    const target = settings.month_target || 5000000;
    const revPct = Math.round((totalRevenue / target) * 100);
    lines.push(`:moneybag: Monthly revenue: ${fmtRevenue(totalRevenue)} / ${fmtRevenue(target)} (${revPct}%)`);
  }

  // Matches
  if (matches) {
    const total = matches.length;
    const annual = settings?.annual_match_target || 200;
    lines.push(`:handshake: Matches: ${total} / ${annual} (annual)`);
  }

  return { response_type: 'in_channel', text: lines.join('\n') };
}

export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);

  if (!verify(req, rawBody)) return res.status(401).json({ error: 'Invalid signature' });

  const params = new URLSearchParams(rawBody);
  const text = params.get('text') || '';
  const userId = params.get('user_id') || '';

  try {
    const result = await handleCommand(text, userId);
    return res.status(200).json(result);
  } catch (e) {
    console.error('Command error:', e);
    return res.status(200).json({ response_type: 'ephemeral', text: `Error: ${e.message}` });
  }
}
