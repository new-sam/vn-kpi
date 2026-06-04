// 팀 데일리 KPI 리포트 텍스트 (cron 팀 채널 + /kpi report 공용)
// 구조: 1.연간 진도율  2.당월 진도율  3.전환율  4.기업당 채용

// KST(UTC+9) 기준 오늘/연/월
function kstNow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    dow: ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()],
  };
}

async function buildTeamReportText(sb) {
  const { y, m, day, dow } = kstNow();
  const ym = `${y}-${String(m).padStart(2, '0')}`;

  const [{ data: matches }, { data: settings }, { data: mct }] = await Promise.all([
    sb.from('matches').select('stage, date, company'),
    sb.from('settings').select('*').single(),
    sb.from('month_channel_targets').select('channel, target').eq('year', y).eq('month', m),
  ]);

  const all = matches || [];
  const confirmed = (r) => r.stage === 'confirmed';
  const confirmedRows = all.filter(confirmed);

  // ① 연간
  const annualConfirmed = confirmedRows.length;
  const annualTarget = settings?.annual_match_target || 200;
  const annualPct = annualTarget ? Math.round((annualConfirmed / annualTarget) * 100) : 0;

  // ② 당월
  const monthConfirmed = confirmedRows.filter((r) => (r.date || '').slice(0, 7) === ym).length;
  const monthTarget = (mct || []).reduce((s, t) => s + (t.target || 0), 0);
  const monthPct = monthTarget ? Math.round((monthConfirmed / monthTarget) * 100) : 0;

  // ③ 지표
  const total = all.length;
  const convRate = total ? Math.round((annualConfirmed / total) * 100) : 0;
  const companies = new Set(confirmedRows.map((r) => (r.company || '').trim()).filter(Boolean));
  const perCompany = companies.size ? (annualConfirmed / companies.size) : 0;

  const L = [];
  L.push(`📊 *${m}/${day} (${dow}) VN KPI 데일리*`);
  L.push('');
  L.push(`*1. 연간 진도율* :  *${annualPct}%*  (${annualConfirmed}/${annualTarget})`);
  L.push(`*2. ${m}월 진도율* :  *${monthPct}%*  (${monthConfirmed}/${monthTarget})`);
  L.push('────────────────────');
  L.push(`*3. 전환율* :  *${convRate}%*  (확정 ${annualConfirmed} / 리드 ${total})`);
  L.push(`*4. 기업당 채용* :  *${perCompany.toFixed(1)}명*`);

  return L.join('\n');
}

module.exports = { buildTeamReportText };
