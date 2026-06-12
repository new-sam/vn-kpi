// 팀 데일리 KPI 리포트 텍스트 (cron 팀 채널)
// 집계는 대시보드(index.html)와 동일.
// DoD = 매일 10:00 시점 값을 kpi_snapshots에 저장해두고, 전일 저장값과 비교 (삭제·수정도 정확히 반영).

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

async function buildTeamReportText(sb, opts = {}) {
  const { y, m, day, dow, hh, mm } = kstNow();
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const yStr = String(y);
  const today = `${ym}-${String(day).padStart(2, '0')}`;
  const yest = (() => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();

  const [{ data: matches }, { data: settings }, { data: mct }, snapRes] = await Promise.all([
    sb.from('matches').select('stage, date, company, source, confirmed_at'),
    sb.from('settings').select('*').single(),
    sb.from('month_channel_targets').select('channel, target').eq('year', y).eq('month', m),
    sb.from('kpi_snapshots').select('data').eq('date', yest).maybeSingle().then(r => r, () => ({ data: null })),
  ]);

  const all = matches || [];
  const effDate = (r) => r.confirmed_at || r.date;
  const isConf = (r) => r.stage === 'confirmed';
  const annualTarget = settings?.annual_match_target || 200;
  const monthTarget = (mct || []).reduce((s, t) => s + (t.target || 0), 0);
  const avg = (a) => a.length ? Math.round(a.reduce((x, z) => x + z, 0) / a.length) : 0;

  // ── 오늘 값 ──
  const confInYear = all.filter(r => isConf(r) && (effDate(r) || '').startsWith(yStr));
  const annualConf = confInYear.length;
  const annualPct = annualTarget ? annualConf / annualTarget * 100 : 0;
  const monthConf = confInYear.filter(r => (effDate(r) || '').slice(0, 7) === ym).length;
  const monthPct = monthTarget ? monthConf / monthTarget * 100 : 0;
  const wspLeads = all.filter(r => r.source === '웍스피어' && (r.date || '').startsWith(yStr)).length;
  const wspConf = confInYear.filter(r => r.source === '웍스피어').length;
  const convRate = wspLeads ? wspConf / wspLeads * 100 : 0;
  const companies = new Set(confInYear.map(r => (r.company || '').trim()).filter(Boolean)).size;
  const perCompany = companies ? annualConf / companies : 0;
  const confLTs = confInYear.filter(r => r.confirmed_at && r.date)
    .map(r => Math.max(0, Math.round((new Date(r.confirmed_at) - new Date(r.date)) / 86400000)));
  const openLTs = all.filter(r => r.date && !['confirmed', 'dropped'].includes(r.stage))
    .map(r => Math.max(0, Math.round((new Date(today) - new Date(r.date)) / 86400000)));
  const leadTime = avg(confLTs.concat(openLTs));

  const cur = { annualPct, monthPct, convRate, perCompany, leadTime };
  const prev = (snapRes && snapRes.data && snapRes.data.data) || null;  // 전일 스냅샷

  const dod = (key, unit, dec = 0) => {
    if (!prev || prev[key] == null) return '';          // 전일 스냅샷 없으면 표시 안 함
    const delta = +(cur[key] - prev[key]).toFixed(dec);
    if (!delta) return '   –';
    return `   ${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(dec)}${unit}`;
  };

  // 오늘 스냅샷 저장 (cron 만; 테이블 없으면 조용히 패스)
  if (opts.persist) {
    try { await sb.from('kpi_snapshots').upsert({ date: today, data: cur }); }
    catch (e) { console.error('snapshot save failed:', e.message); }
  }

  const L = [];
  L.push(`📊 *${m}/${day} (${dow}) VN KPI 데일리*`);
  L.push(`_⏱ ${hh}:${mm} 기준 · 화살표=전일 대비 · 실시간은 대시보드_`);
  L.push('');
  L.push(`*1. 연간 진도율* :  *${Math.round(annualPct)}%*  (${annualConf}/${annualTarget})${dod('annualPct', '%p', 1)}`);
  L.push(`*2. ${m}월 진도율* :  *${Math.round(monthPct)}%*  (${monthConf}/${monthTarget})${dod('monthPct', '%p', 1)}`);
  L.push('────────────────────');
  L.push(`*3. 전환율* :  *${Math.round(convRate)}%*  (웍스 ${wspConf}/${wspLeads})${dod('convRate', '%p', 1)}`);
  L.push(`*4. 기업당 채용* :  *${perCompany.toFixed(1)}명*${dod('perCompany', '', 1)}`);
  L.push(`*5. 평균 리드타임* :  *${leadTime}일*  (확정 ${avg(confLTs)}일 · 진행중 ${avg(openLTs)}일)${dod('leadTime', '일', 0)}`);

  return L.join('\n');
}

module.exports = { buildTeamReportText };
