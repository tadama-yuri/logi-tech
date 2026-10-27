import { escapeHtml, formatDate, formatHours, logRecordChange, recordStats, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

const STATUS_LABELS = { pending: '未承認', approved: '承認済み', returned: '要修正' };
const RECORD_FIELDS = [
  ['date', '勤務日'],
  ['start', '勤務開始'],
  ['end', '勤務終了'],
  ['breakMinutes', '休憩時間'],
  ['waitMinutes', '荷待ち時間'],
  ['note', 'メモ'],
  ['status', '承認状況'],
  ['reviewNote', '差し戻し理由']
];

function canManageRecord(currentUser, record) {
  return currentUser.role === '管理者' || currentUser.id === record.userId;
}

function recordStatus(record) {
  return record.status || 'pending';
}

function fieldValue(record, key) {
  if (key === 'status') return STATUS_LABELS[record.status || 'pending'] || '未承認';
  if (key === 'breakMinutes' || key === 'waitMinutes') return `${Number(record[key] || 0)}分`;
  return String(record[key] || '（なし）');
}

function changedFields(before, after) {
  return RECORD_FIELDS.filter(([key]) => fieldValue(before, key) !== fieldValue(after, key));
}

function auditDetails(event) {
  const fields = RECORD_FIELDS.flatMap(([key, label]) => {
    if (!event.before && !event.after) return [];
    if (!event.before) return [`${label}: ${escapeHtml(fieldValue(event.after, key))}`];
    if (!event.after) return [`削除前の${label}: ${escapeHtml(fieldValue(event.before, key))}`];
    const before = fieldValue(event.before, key);
    const after = fieldValue(event.after, key);
    return before === after ? [] : [`${label}: ${escapeHtml(before)} → ${escapeHtml(after)}`];
  });
  if (event.details) fields.push(escapeHtml(event.details));
  return `<details class="audit-details"><summary>内容を表示</summary><ul>${fields.map((field) => `<li>${field}</li>`).join('') || '<li>内容の詳細はありません</li>'}</ul></details>`;
}

export function renderRecords({ state, currentUser, today, templates }) {
  const rows = [...state.records]
    .filter((record) => currentUser.role === 'ドライバー' ? record.userId === currentUser.id : true)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const tableRows = rows.map((record) => {
    const user = userById(state, record.userId);
    const stats = recordStats(record);
    const status = recordStatus(record);
    const actions = [
      canManageRecord(currentUser, record)
        ? `<button class="button ghost small" data-edit-record="${escapeHtml(record.id)}">編集</button><button class="button danger small" data-delete-record="${escapeHtml(record.id)}">削除</button>`
        : '<span class="panel-meta">閲覧のみ</span>',
      currentUser.role === '管理者' && status !== 'approved'
        ? `<button class="button primary small" data-approve-record="${escapeHtml(record.id)}">承認</button><button class="button ghost small" data-return-record="${escapeHtml(record.id)}">差し戻し</button>`
        : ''
    ].join('');
    const reviewNote = status === 'returned' && record.reviewNote
      ? `<div class="review-note">${escapeHtml(record.reviewNote)}</div>`
      : '';
    return `<tr data-record-row data-name="${escapeHtml(user?.name || '')}" data-date="${escapeHtml(record.date)}" data-status="${escapeHtml(status)}"><td>${formatDate(record.date)}</td><td class="table-person">${escapeHtml(user?.name || '削除済みユーザー')}</td><td class="time">${escapeHtml(record.start)}–${escapeHtml(record.end)}</td><td>${formatHours(stats.work)} h</td><td>${formatHours(stats.wait)} h</td><td><span class="badge ${stats.rate < .7 ? 'warn' : ''}">${Math.round(stats.rate * 100)}%</span></td><td><span class="badge ${status === 'approved' ? '' : 'warn'}">${STATUS_LABELS[status] || STATUS_LABELS.pending}</span>${reviewNote}</td><td><div class="record-actions">${actions}</div></td></tr>`;
  }).join('');
  const auditEntries = (state.auditLog || []).filter((event) => currentUser.role !== 'ドライバー' || event.recordUserId === currentUser.id);
  const auditRows = auditEntries.map((event) => {
    const eventDate = new Date(event.createdAt);
    const dateTime = Number.isNaN(eventDate.getTime()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(eventDate);
    return `<tr><td>${escapeHtml(dateTime)}</td><td>${escapeHtml(event.recordUserName)}<div class="panel-meta">${escapeHtml(event.before?.date || event.after?.date || '')}</div></td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.actorName)}</td><td>${auditDetails(event)}</td></tr>`;
  }).join('');
  return renderTemplate(templates, 'records', {
    RECORD_COUNT: rows.length,
    RECORD_ROWS: tableRows,
    RECORD_ACCESS_NOTE: currentUser.role === '管理者' ? '全ユーザーの記録を編集・審査できます。' : '編集・削除できるのは自分の記録のみです。',
    EMPTY_RECORDS: rows.length ? '' : '<div class="empty"><strong>記録はまだありません</strong>勤務実績を入力するとここに表示されます。</div>',
    AUDIT_COUNT: auditEntries.length,
    AUDIT_ROWS: auditRows,
    EMPTY_AUDIT: auditEntries.length ? '' : '<div class="empty">変更履歴はまだありません</div>'
  });
}

export function bindRecords({ state, currentUser, today, persist, render, showToast }) {
  const search = document.getElementById('record-search');
  const dateFilter = document.getElementById('date-filter');
  const approvalFilter = document.getElementById('approval-filter');
  const editDialog = document.getElementById('record-edit-dialog');
  const editForm = document.getElementById('record-edit-form');
  const canManage = (record) => record && canManageRecord(currentUser, record);
  document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => editDialog.close()));
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('ja');
    const todayOnly = dateFilter.value === 'today';
    let visible = 0;
    document.querySelectorAll('[data-record-row]').forEach((row) => {
      const matches = row.dataset.name.toLocaleLowerCase('ja').includes(query)
        && (!todayOnly || row.dataset.date === today)
        && (approvalFilter.value === 'all' || row.dataset.status === approvalFilter.value);
      row.hidden = !matches;
      if (matches) visible++;
    });
    document.getElementById('record-count').textContent = `${visible} 件`;
    const empty = document.getElementById('filter-empty');
    if (empty) empty.hidden = visible > 0 || state.records.length === 0;
  };
  search.addEventListener('input', filter);
  dateFilter.addEventListener('change', filter);
  approvalFilter.addEventListener('change', filter);
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
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(editForm);
    const record = state.records.find((item) => item.id === data.get('recordId'));
    if (!canManage(record)) {
      editDialog.close();
      return showToast('この記録を編集する権限がありません');
    }

    const before = { ...record };
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
    const changes = changedFields(before, updated);
    if (!changes.length) {
      editDialog.close();
      return showToast('変更された項目はありません');
    }
    const details = `修正箇所: ${changes.map(([, label]) => label).join('、')}。承認状態を未承認に戻しました。`;
    const duplicates = state.records.filter((item) => item.id !== record.id && item.userId === updated.userId && item.date === updated.date).length;
    const duplicateWarning = duplicates ? `\n注意: 同じドライバー・勤務日に他の記録が ${duplicates} 件あります。` : '';
    const driverName = userById(state, updated.userId)?.name || '削除済みユーザー';
    const confirmation = `この内容に変更しますか？\nドライバー: ${driverName}\n勤務日: ${updated.date}\n勤務時間: ${updated.start}〜${updated.end}\n実働: ${formatHours(stats.work)} 時間\n休憩: ${updated.breakMinutes} 分\n荷待ち: ${updated.waitMinutes} 分\n${details}${duplicateWarning}`;
    if (!window.confirm(confirmation)) return;
    Object.assign(record, updated, { status: 'pending', reviewedBy: null, reviewedAt: null, reviewNote: '' });
    logRecordChange(state, record, currentUser, '勤務記録を編集', { before, details });
    if (!await persist()) return;
    editDialog.close();
    render();
    showToast('勤務記録を更新し、未承認に戻しました');
  });
  document.querySelectorAll('[data-approve-record]').forEach((button) => button.addEventListener('click', async () => {
    const record = state.records.find((item) => item.id === button.dataset.approveRecord);
    if (currentUser.role !== '管理者' || !record) return showToast('承認する権限がありません');
    if (!window.confirm('この勤務記録を承認しますか？')) return;
    const before = { ...record };
    Object.assign(record, { status: 'approved', reviewedBy: currentUser.id, reviewedAt: new Date().toISOString(), reviewNote: '' });
    logRecordChange(state, record, currentUser, '勤務記録を承認', { before });
    if (!await persist()) return;
    render();
    showToast('勤務記録を承認しました');
  }));
  document.querySelectorAll('[data-return-record]').forEach((button) => button.addEventListener('click', async () => {
    const record = state.records.find((item) => item.id === button.dataset.returnRecord);
    if (currentUser.role !== '管理者' || !record) return showToast('差し戻す権限がありません');
    const reason = window.prompt('差し戻し理由を入力してください');
    if (reason === null) return;
    if (!reason.trim()) return showToast('差し戻し理由を入力してください');
    if (reason.trim().length > 300) return showToast('差し戻し理由は300文字以内で入力してください');
    const before = { ...record };
    Object.assign(record, { status: 'returned', reviewedBy: currentUser.id, reviewedAt: new Date().toISOString(), reviewNote: reason.trim() });
    logRecordChange(state, record, currentUser, '勤務記録を差し戻し', { before, details: `差し戻し理由: ${reason.trim()}` });
    if (!await persist()) return;
    render();
    showToast('勤務記録を差し戻しました');
  }));
  document.querySelectorAll('[data-delete-record]').forEach((button) => button.addEventListener('click', async () => {
    const record = state.records.find((item) => item.id === button.dataset.deleteRecord);
    if (!canManage(record)) return showToast('この記録を削除する権限がありません');
    if (!window.confirm('この勤務記録を削除しますか？削除履歴は保存されます。')) return;
    logRecordChange(state, record, currentUser, '勤務記録を削除', { before: { ...record }, deleted: true });
    state.records = state.records.filter((item) => item.id !== button.dataset.deleteRecord);
    if (!await persist()) return;
    render();
    showToast('記録を削除しました');
  }));
}
