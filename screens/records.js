import { escapeHtml, formatDate, formatHours, recordStats, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

function canManageRecord(currentUser, record) {
  return currentUser.role === '運行管理者' || currentUser.id === record.userId;
}

export function renderRecords({ state, currentUser, templates }) {
  const rows = [...state.records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const tableRows = rows.map((record) => {
    const user = userById(state, record.userId);
    const stats = recordStats(record);
    const actions = canManageRecord(currentUser, record)
      ? `<button class="button ghost small" data-edit-record="${escapeHtml(record.id)}">編集</button><button class="button danger small" data-delete-record="${escapeHtml(record.id)}" aria-label="${escapeHtml(user?.name || '')}の記録を削除">削除</button>`
      : '<span class="panel-meta">閲覧のみ</span>';
    return `<tr data-record-row data-name="${escapeHtml(user?.name || '')}" data-date="${escapeHtml(record.date)}"><td>${formatDate(record.date)}</td><td class="table-person">${escapeHtml(user?.name || '削除済みユーザー')}</td><td class="time">${escapeHtml(record.start)}–${escapeHtml(record.end)}</td><td>${formatHours(stats.work)} h</td><td>${formatHours(stats.wait)} h</td><td><span class="badge ${stats.rate < .7 ? 'warn' : ''}">${Math.round(stats.rate * 100)}%</span></td><td><div class="record-actions">${actions}</div></td></tr>`;
  }).join('');
  return renderTemplate(templates, 'records', {
    RECORD_COUNT: rows.length,
    RECORD_ROWS: tableRows,
    RECORD_ACCESS_NOTE: currentUser.role === '運行管理者' ? '全ユーザーの記録を編集できます。' : '編集・削除できるのは自分の記録のみです。',
    EMPTY_RECORDS: rows.length ? '' : '<div class="empty"><strong>記録はまだありません</strong>勤務実績を入力するとここに表示されます。</div>'
  });
}

export function bindRecords({ state, currentUser, today, persist, render, showToast }) {
  const search = document.getElementById('record-search');
  const dateFilter = document.getElementById('date-filter');
  const editDialog = document.getElementById('record-edit-dialog');
  const editForm = document.getElementById('record-edit-form');
  const canManage = (record) => record && canManageRecord(currentUser, record);
  document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => editDialog.close()));
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
  document.querySelectorAll('[data-edit-record]').forEach((button) => button.addEventListener('click', () => {
    const record = state.records.find((item) => item.id === button.dataset.editRecord);
    if (!canManage(record)) return showToast('この記録を編集する権限がありません');

    editForm.elements.namedItem('recordId').value = record.id;
    editForm.elements.namedItem('date').value = record.date;
    editForm.elements.namedItem('start').value = record.start;
    editForm.elements.namedItem('end').value = record.end;
    editForm.elements.namedItem('breakMinutes').value = record.breakMinutes ?? 0;
    editForm.elements.namedItem('waitMinutes').value = record.waitMinutes ?? 0;
    editForm.elements.namedItem('note').value = record.note || '';
    editDialog.showModal();
  }));
  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(editForm);
    const record = state.records.find((item) => item.id === data.get('recordId'));
    if (!canManage(record)) {
      editDialog.close();
      return showToast('この記録を編集する権限がありません');
    }

    const updated = {
      ...record,
      date: String(data.get('date')),
      start: String(data.get('start')),
      end: String(data.get('end')),
      breakMinutes: Number(data.get('breakMinutes') || 0),
      waitMinutes: Number(data.get('waitMinutes') || 0),
      note: String(data.get('note') || '')
    };
    const stats = recordStats(updated);
    if (stats.span <= 0 || stats.work <= 0) return showToast('勤務時間と休憩時間を確認してください');
    if (updated.waitMinutes > stats.work) return showToast('荷待ち時間は実働時間以内で入力してください');

    Object.assign(record, updated);
    persist();
    editDialog.close();
    render();
    showToast('勤務記録を更新しました');
  });
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', () => {
    const record = state.records.find((item) => item.id === button.dataset.deleteRecord);
    if (!canManage(record)) return showToast('この記録を削除する権限がありません');
    state.records = state.records.filter((record) => record.id !== button.dataset.deleteRecord);
    persist();
    render();
    showToast('記録を削除しました');
  }));
}