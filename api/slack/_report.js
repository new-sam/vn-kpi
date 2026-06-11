// 팀 데일리 KPI 리포트 텍스트 (cron 팀 채널 + /kpi report 공용)
// 집계는 대시보드(index.html)와 동일. DoD = 어제 시점 값을 데이터로 재계산해 비교.

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()],
    hh: String(d.getUTCHours()).padStart(2, '0'),
    mm: String(d.getUTCMinutes()).padStart(2, '0'),
  };
}

async function buildTeamReportText(sb) {
  const { y, m, day, dow, hh, mm } = kstNow();
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const yStr = String(y);
  const today = `${ym}-${String(day).padStart(2, '0')}`;
  const yest = (() => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();

  const [{ data: matches }, { data: settings }, { data: mct }] = await Promise.all([
    sb.from('matches').select('stage, date, company, source, confirmed_at'),
    sb.from('settings').select('*').single(),
    sb.from('month_channel_targets').select('channel, target').eq('year', y).eq('month', m),
  ]);

  const all = matches || [];
  const effDate = (r) => r.confirmed_at || r.date;       // 확정 유효일 = 확정일(없으면 등록일)
  const isConf = (r) => r.stage === 'confirmed';
  const annualTarget = settings?.annual_match_target || 200;
  const monthTarget = (mct || []).reduce((s, t) => s + (t.target || 0), 0);
  const avg = (a) => a.length ? Math.round(a.reduce((x, z) => x + z, 0) / a.length) : 0;

  // ── as-of 함수 (D = 'YYYY-MM-DD' 시점 누적값) ──
  const annualConf = (D) => all.filter(r => isConf(r) && (effDate(r) || '').startsWith(yStr) && (effDate(r) || '') <= D).length;
  const monthConf  = (D) => all.filter(r => isConf(r) && (effDate(r) || '').slice(0, 7) === ym && (effDate(r) || '') <= D).length;
  const wspLeads   = (D) => all.filter(r => r.source === '웍스피어' && (r.date || '').startsWith(yStr) && (r.date || '') <= D).length;
  const wspConf    = (D) => all.filter(r => isConf(r) && r.source === '웍스피어' && (effDate(r) || '').startsWith(yStr) && (effDate(r) || '') <= D).length;
  const annualPct  = (D) => annualTarget ? annualConf(D) / annualTarget * 100 : 0;
  const monthPct   = (D) => monthTarget ? monthConf(D) / monthTarget * 100 : 0;
  const convRate   = (D) => { const L = wspLeads(D); return L ? wspConf(D) / L * 100 : 0; };
  const perCompany = (D) => {
    const c = all.filter(r => isConf(r) && (effDate(r) || '').startsWith(yStr) && (effDate(r) || '') <= D);
    const co = new Set(c.map(r => (r.company || '').trim()).filter(Boolean)).size;
    return co ? c.length / co : 0;
  };
  const leadTime = (D) => {
    const confs = all.filter(r => isConf(r) && (effDate(r) || '').startsWith(yStr) && r.confirmed_at && r.date && r.confirmed_at <= D)
      .map(r => Math.max(0, Math.round((new Date(r.confirmed_at) - new Date(r.date)) / 86400000)));
    const opens = all.filter(r => r.date && r.date <= D && r.stage !== 'dropped' && !(isConf(r) && r.confirmed_at && r.confirmed_at <= D))
      .map(r => Math.max(0, Math.round((new Date(D) - new Date(r.date)) / 86400000)));
    return avg(confs.concat(opens));
  };

  // 리드타임 확정/진행중 분리 (오늘 표시용)
  const confLTs = all.filter(r => isConf(r) && (effDate(r) || '').startsWith(yStr) && r.confirmed_at && r.date)
    .map(r => Math.max(0, Math.round((new Date(r.confirmed_at) - new Date(r.date)) / 86400000)));
  const openLTs = all.filter(r => r.date && !['confirmed', 'dropped'].includes(r.stage))
    .map(r => Math.max(0, Math.round((new Date(today) - new Date(r.date)) / 86400000)));

  // DoD 포맷 (늘면 좋음 기준; 리드타임만 반대라 호출부에서 화살표만 다름)
  const dod = (delta, unit, dec = 0) => {
    const r = +(delta).toFixed(dec);
    if (!r) return '–';
    return `${r > 0 ? '▲' : '▼'}${Math.abs(r).toFixed(dec)}${unit}`;
  };

  const L = [];
  L.push(`📊 *${m}/${day} (${dow}) VN KPI 데일리*`);
  L.push(`_⏱ ${hh}:${mm} 기준 · 화살표=전일 대비 · 실시간은 대시보드_`);
  L.push('');
  L.push(`*1. 연간 진도율* :  *${Math.round(annualPct(today))}%*  (${annualConf(today)}/${annualTarget})   ${dod(annualPct(today) - annualPct(yest), '%p', 1)}`);
  L.push(`*2. ${m}월 진도율* :  *${Math.round(monthPct(today))}%*  (${monthConf(today)}/${monthTarget})   ${dod(monthPct(today) - monthPct(yest), '%p', 1)}`);
  L.push('────────────────────');
  L.push(`*3. 전환율* :  *${Math.round(convRate(today))}%*  (웍스 ${wspConf(today)}/${wspLeads(today)})   ${dod(convRate(today) - convRate(yest), '%p', 1)}`);
  L.push(`*4. 기업당 채용* :  *${perCompany(today).toFixed(1)}명*   ${dod(perCompany(today) - perCompany(yest), '', 1)}`);
  L.push(`*5. 평균 리드타임* :  *${leadTime(today)}일*  (확정 ${avg(confLTs)}일 · 진행중 ${avg(openLTs)}일)   ${dod(leadTime(today) - leadTime(yest), '일', 0)}`);

  return L.join('\n');
}

module.exports = { buildTeamReportText };
