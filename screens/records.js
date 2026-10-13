import { escapeHtml, formatDate, formatHours, recordStats, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderRecords({ state, templates }) {
  const rows = [...state.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const tableRows = rows.map((record) => {
    const user = userById(state, record.userId);
    const stats = recordStats(record);
    return `<tr data-record-row data-name="${escapeHtml(user?.name || '')}" data-date="${record.date}"><td>${formatDate(record.date)}</td><td class="table-person">${escapeHtml(user?.name || '削除済みユーザー')}</td><td class="time">${escapeHtml(record.start)}–${escapeHtml(record.end)}</td><td>${formatHours(stats.work)} h</td><td>${formatHours(stats.wait)} h</td><td><span class="badge ${stats.rate < .7 ? 'warn' : ''}">${Math.round(stats.rate * 100)}%</span></td><td><button class="button danger small" data-delete-record="${escapeHtml(record.id)}" aria-label="${escapeHtml(user?.name || '')}の記録を削除">削除</button></td></tr>`;
  }).join('');
  return renderTemplate(templates, 'records', {
    RECORD_COUNT: rows.length,
    RECORD_ROWS: tableRows,
    EMPTY_RECORDS: rows.length ? '' : '<div class="empty"><strong>記録はまだありません</strong>勤務実績を入力するとここに表示されます。</div>'
  });
}

export function bindRecords({ state, today, persist, render, showToast }) {
  const search = document.getElementById('record-search');
  const dateFilter = document.getElementById('date-filter');
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('ja');
    const todayOnly = dateFilter.value === 'today';
    let visible = 0;
    document.querySelectorAll('[data-record-row]').forEach((row) => {
      const matches = row.dataset.name.toLocaleLowerCase('ja').includes(query) && (!todayOnly || row.dataset.date === today);
      row.hidden = !matches;
      if (matches) visible++;
    });
    document.getElementById('record-count').textContent = `${visible} 件`;
    const empty = document.getElementById('filter-empty');
    if (empty) empty.hidden = visible > 0 || state.records.length === 0;
  };
  search.addEventListener('input', filter);
  dateFilter.addEventListener('change', filter);
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', () => {
    state.records = state.records.filter((record) => record.id !== button.dataset.deleteRecord);
    persist();
    render();
    showToast('記録を削除しました');
  }));
}