import { escapeHtml, formatDate, formatHours, localDateString, logRecordChange, recordStats, scheduleTimeDelta, userById } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';
import { setupPagination } from '../shared/pagination.js';
import { getSupabaseClient, loadRemoteState } from '../shared/supabase.js';

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

function scheduleComparison(schedule, record) {
  if (!schedule?.start || !schedule?.end) return null;
  const startDelta = scheduleTimeDelta(schedule.start, record.start);
  const endDelta = scheduleTimeDelta(schedule.end, record.end);
  if (startDelta === null || endDelta === null) return null;
  return {
    startDelta,
    endDelta,
    onTime: Math.abs(startDelta) <= 15 && Math.abs(endDelta) <= 15
  };
}

function formatScheduleDelta(delta) {
  if (delta === 0) return '0分';
  return `${delta > 0 ? '+' : '-'}${Math.abs(delta)}分`;
}

function shiftDate(date, days) {
  const shifted = new Date(`${date}T12:00:00`);
  shifted.setDate(shifted.getDate() + days);
  return localDateString(shifted);
}

function filterDateRange({ dateFilter, dateFrom, dateTo, calendarStart, today }) {
  const start = dateFilter === 'today' ? today : dateFilter === 'week' ? calendarStart : '';
  const end = dateFilter === 'today' ? today : dateFilter === 'week' ? shiftDate(calendarStart, 6) : '';
  return {
    start: dateFrom && (!start || dateFrom > start) ? dateFrom : start,
    end: dateTo && (!end || dateTo < end) ? dateTo : end
  };
}

function matchesRecordFilters({ userId, name, date, status }, filters, range) {
  const query = filters.query.trim().toLocaleLowerCase('ja');
  return (!query || name.toLocaleLowerCase('ja').includes(query))
    && (!filters.driverId || userId === filters.driverId)
    && (!range.start || date >= range.start)
    && (!range.end || date <= range.end)
    && (filters.approval === 'all' || status === filters.approval);
}

function renderWeekCalendar({ state, currentUser, startDate, today, filters }) {
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(startDate, index));
  const range = filterDateRange({ ...filters, calendarStart: startDate, today });
  const records = state.records.filter((record) => {
    const user = userById(state, record.userId);
    return (currentUser.role !== 'ドライバー' || record.userId === currentUser.id)
      && matchesRecordFilters({
        ...record,
        name: user?.name || '',
        status: recordStatus(record)
      }, filters, range);
  });
  const schedules = (state.workSchedules || []).filter((schedule) => {
    const user = userById(state, schedule.userId);
    return (currentUser.role !== 'ドライバー' || schedule.userId === currentUser.id)
      && (!filters.query || (user?.name || '').toLocaleLowerCase('ja').includes(filters.query.trim().toLocaleLowerCase('ja')))
      && (!filters.driverId || schedule.userId === filters.driverId)
      && (!range.start || schedule.date >= range.start)
      && (!range.end || schedule.date <= range.end);
  });
  const days = dates.map((date) => {
    const userIds = new Set([
      ...records.filter((record) => record.date === date).map((record) => record.userId),
      ...schedules.filter((schedule) => schedule.date === date).map((schedule) => schedule.userId)
    ]);
    const activities = [...userIds].map((userId) => {
      const user = userById(state, userId);
      const schedule = schedules.find((item) => item.userId === userId && item.date === date);
      const dayRecords = records.filter((record) => record.userId === userId && record.date === date);
      const plannedTime = schedule?.start && schedule?.end
        ? `${escapeHtml(schedule.start)}–${escapeHtml(schedule.end)}`
        : schedule ? '時刻未設定' : '';
      const actualTimes = dayRecords.map((record) => {
        const comparison = schedule && scheduleComparison(schedule, record);
        const outcome = comparison
          ? comparison.onTime
            ? '<span class="calendar-comparison">予定通り（±15分以内）</span>'
            : `<div class="calendar-deltas" aria-label="実績と予定の差（実績 − 予定）"><span>始<strong class="${comparison.startDelta > 0 ? 'late' : 'early'}">${formatScheduleDelta(comparison.startDelta)}</strong></span><span>終<strong class="${comparison.endDelta > 0 ? 'late' : 'early'}">${formatScheduleDelta(comparison.endDelta)}</strong></span></div>`
          : '';
        return `<div class="calendar-actual"><span class="calendar-kind">実績</span><span class="calendar-time">${escapeHtml(record.start)}–${escapeHtml(record.end)}</span>${outcome}</div>`;
      }).join('');
      const status = dayRecords.length
        ? `<span class="calendar-status">${dayRecords.map((record) => escapeHtml(STATUS_LABELS[recordStatus(record)] || STATUS_LABELS.pending)).join('・')}</span>`
        : '';
      return `<article class="calendar-activity"><div class="calendar-person">${escapeHtml(user?.name || '削除済みユーザー')}${status}</div>${schedule ? `<div class="calendar-planned"><span class="calendar-kind">予定</span><span class="calendar-time">${plannedTime}</span></div>` : ''}${actualTimes}</article>`;
    }).join('');
    const dayLabel = formatDate(date);
    return `<section class="week-day ${date === today ? 'is-today' : ''}" aria-label="${escapeHtml(dayLabel)}"><div class="week-day-heading"><strong>${escapeHtml(dayLabel)}</strong>${date === today ? '<span class="today-marker">今日</span>' : ''}</div><div class="week-day-activities">${activities || '<span class="calendar-no-activity">条件に一致する予定・実績なし</span>'}</div></section>`;
  }).join('');
  return { dates, days };
}

export function renderRecords({ state, currentUser, templates, today }) {
  const drivers = state.users.filter((user) => user.role === 'ドライバー');
  const driverFilter = currentUser.role === '管理者'
    ? `<select id="driver-filter" aria-label="ドライバーで絞り込み"><option value="all">全ドライバー</option>${drivers.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join('')}</select>`
    : '';
  const rows = [...state.records]
    .filter((record) => currentUser.role === 'ドライバー' ? record.userId === currentUser.id : true)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const schedules = [...(state.workSchedules || [])]
    .filter((schedule) => currentUser.role === 'ドライバー' ? schedule.userId === currentUser.id : true)
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.userId).localeCompare(String(b.userId)));
  const scheduleRows = schedules.map((schedule) => {
    const user = userById(state, schedule.userId);
    const time = schedule.start && schedule.end
      ? `${escapeHtml(schedule.start)}–${escapeHtml(schedule.end)}`
      : '時刻未設定';
    const deleteAction = currentUser.role === '管理者'
      ? `<button class="button danger small" type="button" data-delete-schedule="${escapeHtml(schedule.userId)}" data-schedule-date="${escapeHtml(schedule.date)}">削除</button>`
      : '';
    return `<div class="schedule-row"><div class="schedule-row-info"><span class="schedule-row-date">${escapeHtml(user?.name || '削除済みユーザー')} · ${escapeHtml(formatDate(schedule.date))}</span><span class="schedule-row-status">${time}</span></div>${deleteAction}</div>`;
  }).join('');
  const tableRows = rows.map((record) => {
    const user = userById(state, record.userId);
    const stats = recordStats(record);
    const status = recordStatus(record);
    const schedule = (state.workSchedules || []).find((item) => item.userId === record.userId && item.date === record.date);
    const comparison = schedule && scheduleComparison(schedule, record);
    const scheduleTime = schedule?.start && schedule?.end
      ? `${escapeHtml(schedule.start)}–${escapeHtml(schedule.end)}`
      : schedule ? '時刻未設定' : '—';
    const comparisonStatus = schedule
      ? comparison
        ? `<span class="badge ${comparison.onTime ? '' : 'warn'}">${comparison.onTime ? '予定通り' : '予定との差あり'}</span>`
        : '<span class="badge warn">比較不可</span>'
      : '—';
    const scheduleDelta = comparison && !comparison.onTime
      ? `<div class="schedule-deltas" aria-label="実績 − 予定"><span>始<strong class="${comparison.startDelta > 0 ? 'late' : 'early'}">${formatScheduleDelta(comparison.startDelta)}</strong></span><span>終<strong class="${comparison.endDelta > 0 ? 'late' : 'early'}">${formatScheduleDelta(comparison.endDelta)}</strong></span></div>`
      : '—';
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
    return `<tr data-record-row data-user-id="${escapeHtml(record.userId)}" data-name="${escapeHtml(user?.name || '')}" data-date="${escapeHtml(record.date)}" data-status="${escapeHtml(status)}"><td>${formatDate(record.date)}</td><td class="table-person">${escapeHtml(user?.name || '削除済みユーザー')}</td><td class="time">${escapeHtml(record.start)}–${escapeHtml(record.end)}</td><td>${scheduleTime}</td><td>${comparisonStatus}</td><td>${scheduleDelta}</td><td>${formatHours(stats.work)} h</td><td>${formatHours(stats.wait)} h</td><td><span class="badge ${stats.rate < .7 ? 'warn' : ''}">${Math.round(stats.rate * 100)}%</span></td><td><span class="badge ${status === 'approved' ? '' : 'warn'}">${STATUS_LABELS[status] || STATUS_LABELS.pending}</span>${reviewNote}</td><td><div class="record-actions">${actions}</div></td></tr>`;
  }).join('');
  const auditEntries = (state.auditLog || []).filter((event) => currentUser.role !== 'ドライバー' || event.recordUserId === currentUser.id);
  const auditRows = auditEntries.map((event) => {
    const eventDate = new Date(event.createdAt);
    const dateTime = Number.isNaN(eventDate.getTime()) ? '日時不明' : new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short' }).format(eventDate);
    const snapshot = event.after || event.before;
    return `<tr data-audit-row data-user-id="${escapeHtml(event.recordUserId)}" data-name="${escapeHtml(event.recordUserName || '')}" data-date="${escapeHtml(snapshot?.date || '')}" data-status="${escapeHtml(snapshot?.status || 'pending')}"><td>${escapeHtml(dateTime)}</td><td>${escapeHtml(event.recordUserName)}<div class="panel-meta">${escapeHtml(snapshot?.date || '')}</div></td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.actorName)}</td><td>${auditDetails(event)}</td></tr>`;
  }).join('');
  return renderTemplate(templates, 'records', {
    RECORD_COUNT: rows.length,
    DRIVER_FILTER: driverFilter,
    SCHEDULE_COUNT: schedules.length,
    SCHEDULE_ROWS: scheduleRows,
    EMPTY_SCHEDULES: schedules.length ? '' : '<div class="empty">勤務予定はまだありません</div>',
    CALENDAR_DAYS: renderWeekCalendar({
      state,
      currentUser,
      startDate: shiftDate(today, -6),
      today,
      filters: { query: '', driverId: '', dateFilter: 'week', dateFrom: '', dateTo: '', approval: 'all' }
    }).days,
    CALENDAR_RANGE: `${formatDate(shiftDate(today, -6))} ～ ${formatDate(today)}`,
    RECORD_ROWS: tableRows,
    RECORD_ACCESS_NOTE: currentUser.role === '管理者' ? '全ユーザーの記録を編集・審査できます。' : '編集・削除できるのは自分の記録のみです。',
    EMPTY_RECORDS: rows.length ? '' : '<div class="empty"><strong>記録はまだありません</strong>勤務実績を入力するとここに表示されます。</div>',
    AUDIT_COUNT: auditEntries.length,
    AUDIT_ROWS: auditRows,
    EMPTY_AUDIT: auditEntries.length ? '' : '<div class="empty">変更履歴はまだありません</div>',
    AUDIT_PANEL: currentUser.role === '管理者' ? `<article class="panel audit-panel"><div class="panel-heading"><h2 class="panel-title">変更履歴・審査履歴</h2><span class="panel-meta" id="audit-count">${auditEntries.length} 件</span></div><div class="table-wrap" data-audit-pagination><table><thead><tr><th>日時</th><th>勤務日・ドライバー</th><th>操作</th><th>実行者</th><th>内容</th></tr></thead><tbody>${auditRows}</tbody></table>${auditEntries.length ? '' : '<div class="empty">変更履歴はまだありません</div>'}</div><div class="empty" id="audit-filter-empty" hidden>条件に一致する履歴がありません</div></article>` : ''
  });
}

export function bindRecords({ state, currentUser, today, persist, render, showToast, remoteMode }) {
  const search = document.getElementById('record-search');
  const driverFilter = document.getElementById('driver-filter');
  const dateFilter = document.getElementById('date-filter');
  const dateFrom = document.getElementById('date-from');
  const dateTo = document.getElementById('date-to');
  const approvalFilter = document.getElementById('approval-filter');
  const calendar = document.getElementById('week-calendar');
  const calendarRange = document.getElementById('calendar-range');
  const filters = () => ({
    query: search.value,
    driverId: driverFilter?.value === 'all' ? '' : driverFilter?.value || '',
    dateFilter: dateFilter.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    approval: approvalFilter.value
  });
  let calendarStart = shiftDate(today, -6);
  const updateCalendar = () => {
    const currentFilters = filters();
    const { dates, days } = renderWeekCalendar({
      state,
      currentUser,
      startDate: calendarStart,
      today,
      filters: currentFilters
    });
    calendar.innerHTML = days;
    calendarRange.textContent = `${formatDate(dates[0])} ～ ${formatDate(dates[6])}`;
  };
  document.getElementById('calendar-previous').addEventListener('click', () => {
    calendarStart = shiftDate(calendarStart, -7);
    filter();
  });
  document.getElementById('calendar-next').addEventListener('click', () => {
    calendarStart = shiftDate(calendarStart, 7);
    filter();
  });
  document.getElementById('calendar-latest').addEventListener('click', () => {
    calendarStart = shiftDate(today, -6);
    filter();
  });
  updateCalendar();
  const editDialog = document.getElementById('record-edit-dialog');
  const editForm = document.getElementById('record-edit-form');
  const canManage = (record) => record && canManageRecord(currentUser, record);
  const recordPagination = setupPagination(document.querySelector('[data-record-pagination]'), '[data-record-row]');
  const auditContainer = document.querySelector('[data-audit-pagination]');
  const auditPagination = setupPagination(auditContainer, '[data-audit-row]');
  setupPagination(document.querySelector('[data-schedule-pagination]'), '.schedule-row');
  document.querySelectorAll('[data-close-edit]').forEach((button) => button.addEventListener('click', () => editDialog.close()));
  document.querySelectorAll('[data-delete-schedule]').forEach((button) => button.addEventListener('click', async () => {
    if (currentUser.role !== '管理者') return showToast('勤務予定を削除する権限がありません');
    const userId = button.dataset.deleteSchedule;
    const date = button.dataset.scheduleDate;
    if (!window.confirm(`${date} の勤務予定を削除しますか？`)) return;
    try {
      if (remoteMode) {
        const client = await getSupabaseClient();
        const { error } = await client.from('work_schedules').delete().eq('user_id', userId).eq('work_date', date);
        if (error) throw error;
        const latestState = await loadRemoteState();
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, latestState);
      } else {
        state.workSchedules = (state.workSchedules || []).filter((item) => item.userId !== userId || item.date !== date);
        if (!await persist()) return;
      }
      render();
      showToast('勤務予定を削除しました');
    } catch (error) {
      console.error('勤務予定を削除できませんでした。', error);
      showToast(`勤務予定の削除に失敗しました: ${error.message}`);
    }
  }));
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('ja');
    const invalidDateRange = dateFrom.value && dateTo.value && dateFrom.value > dateTo.value;
    const currentFilters = filters();
    const range = filterDateRange({ ...currentFilters, calendarStart, today });
    let visible = 0;
    document.getElementById('date-filter-error').hidden = !invalidDateRange;
    document.querySelectorAll('[data-record-row]').forEach((row) => {
      const matches = !invalidDateRange && matchesRecordFilters({
        userId: row.dataset.userId,
        name: row.dataset.name,
        date: row.dataset.date,
        status: row.dataset.status
      }, currentFilters, range);
      row.dataset.paginationFiltered = String(!matches);
      if (matches) visible++;
    });
    document.getElementById('record-count').textContent = `${visible} 件`;
    recordPagination.refresh(true);
    const empty = document.getElementById('filter-empty');
    if (empty) empty.hidden = visible > 0 || state.records.length === 0;
    if (auditContainer) {
      let auditVisible = 0;
      auditContainer.querySelectorAll('[data-audit-row]').forEach((row) => {
        const matches = !invalidDateRange && matchesRecordFilters({
          userId: row.dataset.userId,
          name: row.dataset.name,
          date: row.dataset.date,
          status: row.dataset.status
        }, currentFilters, range);
        row.dataset.paginationFiltered = String(!matches);
        if (matches) auditVisible++;
      });
      document.getElementById('audit-count').textContent = `${auditVisible} 件`;
      auditPagination.refresh(true);
      document.getElementById('audit-filter-empty').hidden = auditVisible > 0 || !auditContainer.querySelector('[data-audit-row]');
    }
    updateCalendar();
  };
  filter();
  search.addEventListener('input', filter);
  driverFilter?.addEventListener('change', filter);
  dateFilter.addEventListener('change', () => {
    if (dateFilter.value === 'week') calendarStart = shiftDate(today, -6);
    filter();
  });
  dateFrom.addEventListener('input', filter);
  dateTo.addEventListener('input', filter);
  dateFrom.addEventListener('change', filter);
  dateTo.addEventListener('change', filter);
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
