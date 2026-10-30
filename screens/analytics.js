import { escapeHtml, formatDate, formatHours, recordStats, recordsForToday, totals, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

function createLocalReport(state, today) {
  const daily = recordsForToday(state, today);
  const dailyTotal = totals(daily);
  const allTotal = totals(state.records);
  const rate = dailyTotal.work ? Math.round(dailyTotal.active / dailyTotal.work * 100) : 0;
  const waitRate = dailyTotal.work ? Math.round(dailyTotal.wait / dailyTotal.work * 100) : 0;
  const lines = [
    `本日は${daily.length}件の勤務記録があり、実働時間は${formatHours(dailyTotal.work)}時間、荷待ち時間は${formatHours(dailyTotal.wait)}時間でした。`,
    `本日の稼働率は${rate}%です。`
  ];
  if (!daily.length) {
    lines.push('本日の記録がないため、勤務実績を入力すると詳細な集計を確認できます。');
  } else if (waitRate >= 20) {
    lines.push(`荷待ち時間が実働時間の${waitRate}%を占めています。荷待ちの発生地点や時間帯を確認することを推奨します。`);
  } else {
    lines.push(`荷待ち時間は実働時間の${waitRate}%です。現在の勤務記録を継続して確認してください。`);
  }
  lines.push(`全期間では${state.records.length}件、実働${formatHours(allTotal.work)}時間、荷待ち${formatHours(allTotal.wait)}時間を集計しています。`);
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
    AI_REPORT: '<article class="panel ai-panel"><div class="panel-heading"><div><h2 class="panel-title">自動レポート</h2><p class="panel-meta">アプリ内で集計します。外部AIサービスへの送信はありません。</p></div><button class="button primary small" id="local-report-button" type="button">レポートを作成</button></div><div id="local-report-result" class="ai-report-result" role="status" hidden></div></article>'
  });
}

export function bindAnalytics({ state, today, currentUser }) {
  if (currentUser.role !== '管理者') return;
  const button = document.getElementById('local-report-button');
  const result = document.getElementById('local-report-result');
  if (!button || !result) return;
  button.addEventListener('click', () => {
    result.hidden = false;
    result.textContent = createLocalReport(state, today);
  });
}