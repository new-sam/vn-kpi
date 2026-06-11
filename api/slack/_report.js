// 팀 데일리 KPI 리포트 텍스트 (cron 팀 채널 + /kpi report 공용)
// 구조: 1.연간 진도율  2.당월 진도율  3.전환율  4.기업당 채용
// 집계는 대시보드(index.html)와 동일: 확정은 confirmed_at(없으면 date) 기준, 전환율=웍스피어 리드 중 확정

// KST(UTC+9) 기준 오늘/연/월
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

  const [{ data: matches }, { data: settings }, { data: mct }] = await Promise.all([
    sb.from('matches').select('stage, date, company, source, confirmed_at'),
    sb.from('settings').select('*').single(),
    sb.from('month_channel_targets').select('channel, target').eq('year', y).eq('month', m),
  ]);

  const all = matches || [];
  const effDate = (r) => r.confirmed_at || r.date;          // 확정 유효일 = 확정일(없으면 등록일)
  const isConfirmed = (r) => r.stage === 'confirmed';
  const confInYear = all.filter((r) => isConfirmed(r) && (effDate(r) || '').startsWith(yStr));

  // ① 연간 진도율 (확정 / 연 목표)
  const annualConfirmed = confInYear.length;
  const annualTarget = settings?.annual_match_target || 200;
  const annualPct = annualTarget ? Math.round((annualConfirmed / annualTarget) * 100) : 0;

  // ② 당월 진도율 (확정일이 당월인 확정 / 당월 채널목표 합)
  const monthConfirmed = confInYear.filter((r) => (effDate(r) || '').slice(0, 7) === ym).length;
  const monthTarget = (mct || []).reduce((s, t) => s + (t.target || 0), 0);
  const monthPct = monthTarget ? Math.round((monthConfirmed / monthTarget) * 100) : 0;

  // ③ 전환율 = 웍스피어 리드 중 확정시킨 비율
  const wspLeads = all.filter((r) => r.source === '웍스피어' && (r.date || '').startsWith(yStr)).length;
  const wspConfirmed = confInYear.filter((r) => r.source === '웍스피어').length;
  const convRate = wspLeads ? Math.round((wspConfirmed / wspLeads) * 100) : 0;

  // ④ 기업당 채용 = 확정 / 확정 기업수
  const companies = new Set(confInYear.map((r) => (r.company || '').trim()).filter(Boolean));
  const perCompany = companies.size ? (annualConfirmed / companies.size) : 0;

  const L = [];
  L.push(`📊 *${m}/${day} (${dow}) VN KPI 데일리*`);
  L.push(`_⏱ ${hh}:${mm} 기준 · 실시간 최신값은 대시보드_`);
  L.push('');
  L.push(`*1. 연간 진도율* :  *${annualPct}%*  (${annualConfirmed}/${annualTarget})`);
  L.push(`*2. ${m}월 진도율* :  *${monthPct}%*  (${monthConfirmed}/${monthTarget})`);
  L.push('────────────────────');
  L.push(`*3. 전환율* :  *${convRate}%*  (웍스 확정 ${wspConfirmed} / 웍스 리드 ${wspLeads})`);
  L.push(`*4. 기업당 채용* :  *${perCompany.toFixed(1)}명*`);

  return L.join('\n');
}

module.exports = { buildTeamReportText };
