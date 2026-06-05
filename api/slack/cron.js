// 평일 10:00 KST 자동 발송 — KPI 리포트를 Slack 웹훅으로 팀 채널에 1건 POST
const { buildTeamReportText } = require('./_report');

let _sb;
function getSb() {
  if (!_sb) {
    const { createClient } = require('@supabase/supabase-js');
    // env 붙여넣기 시 끼어든 줄바꿈/공백 제거 (JWT엔 공백이 없으므로 안전)
    const url = (process.env.SUPABASE_URL || '').replace(/\s/g, '');
    const key = (process.env.SUPABASE_SERVICE_KEY || '').replace(/\s/g, '');
    _sb = createClient(url, key);
  }
  return _sb;
}

module.exports = async function handler(req, res) {
  // Vercel Cron 이 CRON_SECRET 을 Authorization 헤더로 자동 전송
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const text = await buildTeamReportText(getSb());
    const r = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`Slack ${r.status}: ${await r.text()}`);
    return res.status(200).json({ ok: true, sent: new Date().toISOString() });
  } catch (e) {
    console.error('Cron error:', e);
    return res.status(500).json({ error: e.message });
  }
};
