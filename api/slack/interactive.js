import crypto from 'crypto';

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

function verify(req, body) {
  const ts = req.headers['x-slack-request-timestamp'];
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = 'v0=' + crypto.createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${ts}:${body}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(req.headers['x-slack-signature']));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  if (!verify(req, rawBody)) return res.status(401).json({ error: 'Invalid signature' });

  // Interactive payloads come as URL-encoded "payload" field
  const params = new URLSearchParams(rawBody);
  const payload = JSON.parse(params.get('payload') || '{}');

  // Placeholder for future button/modal interactions
  console.log('Interactive payload:', payload.type);

  return res.status(200).json({ ok: true });
}
