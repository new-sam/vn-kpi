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

  // 진단용: ?debug=1 → 슬랙 발송 없이 env/쿼리 상태만 반환
  if (new URL(req.url, `https://${req.headers.host}`).searchParams.get('debug') === '1') {
    const key = process.env.SUPABASE_SERVICE_KEY || '';
    const sb = getSb();
    const m = await sb.from('matches').select('stage, date, company');
    const s = await sb.from('settings').select('*').single();
    const t = await sb.from('month_channel_targets').select('channel, target');
    return res.status(200).json({
      env: {
        SUPABASE_URL: process.env.SUPABASE_URL || null,
        SERVICE_KEY_len: key.length,
        SERVICE_KEY_last4: key.slice(-4),
        SERVICE_KEY_hasNewline: /\s/.test(key),
        WEBHOOK_set: !!process.env.SLACK_WEBHOOK_URL,
      },
      matches: { count: m.data ? m.data.length : null, error: m.error?.message || null },
      settings: { ok: !!s.data, error: s.error?.message || null },
      targets: { count: t.data ? t.data.length : null, error: t.error?.message || null },
      report: await buildTeamReportText(getSb()),
    });
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
