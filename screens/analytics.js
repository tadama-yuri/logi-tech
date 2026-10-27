import { escapeHtml, formatDate, formatHours, recordStats, recordsForToday, totals, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

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
    TOTAL_WORK: formatHours(all.work), TOTAL_WAIT: formatHours(all.wait)
  });
}

export function bindAnalytics() {}