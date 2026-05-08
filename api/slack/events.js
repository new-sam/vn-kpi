import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

function verify(req, body) {
  const ts = req.headers['x-slack-request-timestamp'];
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${ts}:${body}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.headers['x-slack-signature']));
}

async function slackPost(channel, text, blocks) {
  const body = { channel, text };
  if (blocks) body.blocks = blocks;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function progressBar(pct, len = 10) {
  const filled = Math.round((pct / 100) * len);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(len - filled);
}

// Handle DM number input: user sends "2" or "1 3" to mark milestones done
async function handleDM(event) {
  const userId = event.user;
  const text = (event.text || '').trim();

  // Ignore bot messages
  if (event.bot_id) return;

  // Check if it's a number pattern like "1" or "2 3" or "1,3"
  const nums = text.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n > 0);
  if (nums.length === 0) {
    await slackPost(event.channel, 'Type milestone numbers to mark them done (e.g. `1 3`), or use `/kpi help` for all commands.');
    return;
  }

  // Get user's name via email
  const userRes = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
    headers: { Authorization: `Bearer ${BOT_TOKEN}` },
  });
  const userData = await userRes.json();
  const email = userData?.user?.profile?.email;
  const { data: profile } = await sb.from('profiles').select('name').eq('email', email).single();
  const name = profile?.name || '';

  if (!name) {
    await slackPost(event.channel, 'Could not find your profile. Make sure your Slack email matches your KPI dashboard email.');
    return;
  }

  // Find user's pending milestones across all projects
  const { data: projects } = await sb.from('projects').select('*').order('created_at');
  const pending = [];
  projects?.forEach(p => {
    (p.subtasks || []).forEach((s, idx) => {
      if ((s.owner || '').includes(name) && !s.done) {
        pending.push({ project: p, subtask: s, subtaskIdx: idx });
      }
    });
  });

  if (pending.length === 0) {
    await slackPost(event.channel, `:tada: No pending milestones! You're all caught up.`);
    return;
  }

  const results = [];
  for (const num of nums) {
    const item = pending[num - 1];
    if (!item) {
      results.push(`:x: #${num} - not found`);
      continue;
    }

    item.subtask.done = true;
    item.subtask.status = 'done';
    item.subtask.progress = 100;

    const tasks = item.project.subtasks || [];
    const { error } = await sb.from('projects').update({ subtasks: tasks }).eq('id', item.project.id);

    if (error) {
      results.push(`:x: #${num} "${item.subtask.title}" - error: ${error.message}`);
    } else {
      const done = tasks.filter(t => t.done).length;
      const pct = Math.round((done / tasks.length) * 100);
      results.push(`:white_check_mark: *"${item.subtask.title}"* done! ${item.project.icon || ''} ${item.project.name} ${progressBar(pct)} ${pct}%`);
    }
  }

  await slackPost(event.channel, results.join('\n'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();
  const payload = JSON.parse(rawBody);

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return res.status(200).json({ challenge: payload.challenge });
  }

  if (!verify(req, rawBody)) return res.status(401).json({ error: 'Invalid signature' });

  // Acknowledge immediately (Slack requires response within 3s)
  res.status(200).json({ ok: true });

  // Process event async
  if (payload.event?.type === 'message' && payload.event?.channel_type === 'im') {
    await handleDM(payload.event).catch(e => console.error('DM handler error:', e));
  }
}
