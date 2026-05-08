let _sb;
function getSb() {
  if (!_sb) {
    const { createClient } = require('@supabase/supabase-js');
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _sb;
}

const BOT_TOKEN = () => process.env.SLACK_BOT_TOKEN;
const TEAM_CHANNEL = () => process.env.SLACK_TEAM_CHANNEL || '#_newbiz-div';

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

async function slackPost(channel, text) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOT_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, text }),
  });
}

async function getSlackUsers() {
  const res = await fetch('https://slack.com/api/users.list', {
    headers: { Authorization: `Bearer ${BOT_TOKEN()}` },
  });
  const data = await res.json();
  return data.members || [];
}

async function openDM(userId) {
  const res = await fetch('https://slack.com/api/conversations.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOT_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ users: userId }),
  });
  const data = await res.json();
  return data.channel?.id;
}

async function buildNameToSlackMap() {
  const { data: profiles } = await getSb().from('profiles').select('name, email');
  const slackUsers = await getSlackUsers();

  const map = {};
  profiles?.forEach(p => {
    if (!p.name || !p.email) return;
    const slackUser = slackUsers.find(u => u.profile?.email === p.email && !u.deleted);
    if (slackUser) map[p.name] = slackUser.id;
  });
  return map;
}

async function sendPersonalReminders(projects, nameMap) {
  const today = new Date().toISOString().slice(0, 10);
  const ownerTasks = {};

  projects?.forEach(p => {
    (p.subtasks || []).forEach(s => {
      if (s.done) return;
      const owner = s.owner || p.owner || '';
      if (!owner) return;
      if (!ownerTasks[owner]) ownerTasks[owner] = [];
      ownerTasks[owner].push({ project: p, subtask: s });
    });
  });

  for (const [owner, tasks] of Object.entries(ownerTasks)) {
    const slackId = nameMap[owner];
    if (!slackId) continue;

    const dmChannel = await openDM(slackId);
    if (!dmChannel) continue;

    const lines = [`:clipboard: *${owner}님 pending milestones*\n`];
    let num = 1;
    let currentProject = '';

    tasks.forEach(({ project, subtask }) => {
      if (project.name !== currentProject) {
        currentProject = project.name;
        lines.push(`\n*${project.icon || ''} ${project.name}*`);
      }
      const daysLeft = Math.ceil((new Date(subtask.end) - new Date(today)) / 86400000);
      const warn = daysLeft <= 3 ? ' :warning:' : '';
      lines.push(` ${num}. ${subtask.title} (~${fmtDate(subtask.end)}, D${daysLeft > 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)})${warn}`);
      num++;
    });

    lines.push('\nComplete? Reply with the number(s) (e.g. `1` or `1 3`)');
    await slackPost(dmChannel, lines.join('\n'));
  }
}

async function sendTeamReport(projects, settings, matches) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`:bar_chart: *VN KPI Daily Report* (${today})\n`];

  projects?.forEach(p => {
    const tasks = p.subtasks || [];
    const done = tasks.filter(s => s.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const emoji = pct >= 80 ? ':large_blue_circle:' : pct >= 50 ? ':large_yellow_circle:' : ':red_circle:';

    lines.push(`${emoji} *${p.icon || ''} ${p.name}* (@${p.owner || '?'}) ${progressBar(pct)} ${pct}%`);

    const upcoming = tasks.filter(s => !s.done).sort((a, b) => (a.end || '').localeCompare(b.end || ''));
    upcoming.slice(0, 2).forEach(s => {
      const daysLeft = Math.ceil((new Date(s.end) - new Date(today)) / 86400000);
      const warn = daysLeft <= 3 ? ' :warning:' : '';
      lines.push(`   :hourglass: ${s.title} (D${daysLeft > 0 ? '-' + daysLeft : '+' + Math.abs(daysLeft)})${warn}`);
    });
    lines.push('');
  });

  if (settings) {
    const totalRevenue = projects?.reduce((sum, p) => sum + (p.actual_revenue || 0), 0) || 0;
    const target = settings.month_target || 5000000;
    const revPct = Math.round((totalRevenue / target) * 100);
    lines.push(`:moneybag: Monthly revenue: ${fmtRevenue(totalRevenue)} / ${fmtRevenue(target)} (${revPct}%)`);
  }

  if (matches) {
    const total = matches.length;
    const annual = settings?.annual_match_target || 200;
    lines.push(`:handshake: Matches: ${total} / ${annual} (annual)`);
  }

  await slackPost(TEAM_CHANNEL(), lines.join('\n'));
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [{ data: projects }, { data: settings }, { data: matches }] = await Promise.all([
      getSb().from('projects').select('*').order('created_at'),
      getSb().from('settings').select('*').single(),
      getSb().from('matches').select('*'),
    ]);

    const nameMap = await buildNameToSlackMap();

    await Promise.all([
      sendPersonalReminders(projects, nameMap),
      sendTeamReport(projects, settings, matches),
    ]);

    return res.status(200).json({ ok: true, sent: new Date().toISOString() });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
};
