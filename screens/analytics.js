import { escapeHtml, formatDate, formatHours, recordStats, recordsForToday, totals, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

function createLocalReport(state, startDate, endDate) {
  const records = state.records.filter((record) => record.date >= startDate && record.date <= endDate);
  if (!records.length) {
    return `対象期間：${startDate} ～ ${endDate}\n対象期間にデータがありません。`;
  }
  const periodTotal = totals(records);
  const rate = periodTotal.work ? Math.round(periodTotal.active / periodTotal.work * 100) : 0;
  const waitRate = periodTotal.work ? Math.round(periodTotal.wait / periodTotal.work * 100) : 0;
  const lines = [
    `対象期間：${startDate} ～ ${endDate}`,
    `${records.length}件の勤務記録があり、実働時間は${formatHours(periodTotal.work)}時間、荷待ち時間は${formatHours(periodTotal.wait)}時間でした。`,
    `対象期間の稼働率は${rate}%です。`,
    `稼働ドライバー数は${periodTotal.people.size}名です。`
  ];
  if (waitRate >= 20) {
    lines.push(`荷待ち時間が実働時間の${waitRate}%を占めています。荷待ちの発生地点や時間帯を確認することを推奨します。`);
  } else {
    lines.push(`荷待ち時間は実働時間の${waitRate}%です。勤務記録を継続して確認してください。`);
  }
  lines.push('このレポートはアプリ内で集計値から自動生成されています。外部サービスへのデータ送信はありません。');
  return lines.join('\n');
}

export function renderAnalytics({ state, today, templates, currentUser }) {
  if (currentUser.role === 'ドライバー') {
    return '<section class="page fade-in"><div class="panel"><h1>アクセス権がありません</h1><p>稼働分析は管理者のみ閲覧できます。</p></div></section>';
  }
  const daily = recordsForToday(state, today);
  const sum = totals(daily);
  const all = totals(state.records);
  const rate = sum.work ? Math.round(sum.active / sum.work * 100) : 0;
  const byUser = state.users.filter((user) => user.role === 'ドライバー').map((user) => {
    const rows = daily.filter((record) => record.userId === user.id);
    const total = totals(rows);
    return { user, count: rows.length, work: total.work, rate: total.work ? total.active / total.work : 0 };
  }).filter((row) => row.count).sort((a, b) => b.rate - a.rate);
  const recent = [...state.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 4);
  const bars = byUser.length ? `<div class="bar-list">${byUser.map((row) => `<div class="bar-row"><span class="bar-name">${escapeHtml(row.user.name)}</span><div class="bar-track" title="実働 ${formatHours(row.work)} 時間"><div class="bar-fill ${row.rate < .7 ? 'low' : ''}" style="width:${Math.round(row.rate * 100)}%"></div></div><span class="bar-number">${Math.round(row.rate * 100)}%</span></div>`).join('')}</div><div class="legend"><span><i></i>稼働時間</span><span><i class="coral"></i>稼働率 70% 未満</span></div>` : '<div class="empty"><strong>今日の記録はまだありません</strong>勤務実績を入力すると、ドライバー別に表示します。</div>';
  const recentRows = recent.length ? recent.map((record) => { const user = userById(state, record.userId); const stats = recordStats(record); return `<div class="activity-row"><div><div class="activity-person">${escapeHtml(user?.name || '削除済みユーザー')}</div><div class="activity-sub">${formatDate(record.date)} · 実働 ${formatHours(stats.work)}h</div></div><span class="badge ${stats.rate < .7 ? 'warn' : ''}">稼働 ${Math.round(stats.rate * 100)}%</span></div>`; }).join('') : '<div class="empty">記録はありません</div>';
  return renderTemplate(templates, 'analytics', {
    WORK_HOURS: formatHours(sum.work), WAIT_HOURS: formatHours(sum.wait), RATE: rate,
    DRIVER_COUNT: sum.people.size, USER_COUNT: state.users.length, TODAY_RECORDS: daily.length,
    BAR_CONTENT: bars, RECENT_CONTENT: recentRows, TOTAL_RECORDS: state.records.length,
    TOTAL_WORK: formatHours(all.work), TOTAL_WAIT: formatHours(all.wait),
    AI_REPORT: `<article class="panel ai-panel"><div class="panel-heading"><div><h2 class="panel-title">期間別自動レポート</h2><p class="panel-meta">指定期間の集計値から作成します。外部AIサービスへの送信はありません。</p></div></div><form id="local-report-form" class="report-form"><div class="field"><label for="report-start-date">開始日</label><input id="report-start-date" name="startDate" type="date" value="${escapeHtml(today)}" required></div><div class="field"><label for="report-end-date">終了日</label><input id="report-end-date" name="endDate" type="date" value="${escapeHtml(today)}" required></div><button class="button primary small" type="submit">レポートを作成</button></form><div id="local-report-result" class="ai-report-result" role="status" hidden></div></article>`
  });
}

export function bindAnalytics({ state, currentUser }) {
  if (currentUser.role !== '管理者') return;
  const form = document.getElementById('local-report-form');
  const result = document.getElementById('local-report-result');
  if (!form || !result) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const startDate = String(data.get('startDate'));
    const endDate = String(data.get('endDate'));
    result.hidden = false;
    if (!startDate || !endDate) {
      result.textContent = '開始日と終了日を入力してください。';
    } else if (startDate > endDate) {
      result.textContent = '開始日は終了日以前の日付を指定してください。';
    } else {
      result.textContent = createLocalReport(state, startDate, endDate);
    }
  });
}