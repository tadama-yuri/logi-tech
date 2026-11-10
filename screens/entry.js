import { escapeHtml, formatDate, formatHours, localDateString, logRecordChange, minutesBetween, recordStats, scheduleForDate } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';
import { refreshShiftReminder } from '../shared/layout.js';
import { setupPagination } from '../shared/pagination.js';
import { getSupabaseClient, loadRemoteState } from '../shared/supabase.js';

function renderScheduleControls({ state, currentUser, today, remoteMode }) {
  if (currentUser.role !== '管理者') return '';

  const drivers = state.users.filter((user) => user.role === 'ドライバー');
  const driverOptions = drivers.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join('');
  const scheduleRows = [...(state.workSchedules || [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((schedule) => {
      const driver = drivers.find((user) => user.id === schedule.userId);
      if (!driver) return '';
      return `<div class="schedule-row"><div class="schedule-row-info"><span class="schedule-row-date">${escapeHtml(driver.name)} · ${escapeHtml(formatDate(schedule.date))}</span><span class="schedule-row-status">${schedule.start && schedule.end ? `${escapeHtml(schedule.start)}–${escapeHtml(schedule.end)}` : '時刻未設定'}</span></div><button class="button danger small" type="button" data-delete-schedule="${escapeHtml(schedule.userId)}" data-schedule-date="${escapeHtml(schedule.date)}">削除</button></div>`;
    }).join('');
  const tableUnavailable = remoteMode && state.workSchedulesAvailable === false;
  const timesUnavailable = remoteMode && state.workSchedulesAvailable !== false && state.workScheduleTimesAvailable === false;
  const setupWarning = tableUnavailable
    ? '<p class="schedule-setup-warning" role="alert">勤務予定テーブルがまだ作成されていません。Supabase の SQL Editor で <code>supabase/schedule-migration.sql</code> を実行してください。</p>'
    : timesUnavailable
      ? '<p class="schedule-setup-warning" role="alert">勤務予定の時刻列がありません。既存の予定を保ったまま時刻列を追加するため、Supabase の SQL Editor で <code>supabase/schedule-migration.sql</code> を実行してください。</p>'
      : '';
  const disabled = tableUnavailable || timesUnavailable;
  return `<section class="panel schedule-panel" aria-labelledby="schedule-title"><div class="panel-heading"><div><div class="eyebrow">WORK SCHEDULE</div><h2 class="panel-title" id="schedule-title">勤務予定を登録</h2></div></div>${setupWarning}<p class="subtitle">ドライバー・勤務日・予定時刻を登録します。同じドライバーと勤務日の予定を再登録すると時刻を更新できます。</p><form id="schedule-form" class="schedule-form"><div class="field"><label for="schedule-driver">ドライバー</label><select id="schedule-driver" name="userId" required ${disabled ? 'disabled' : ''}>${driverOptions || '<option value="">ドライバーがいません</option>'}</select></div><div class="field"><label for="schedule-date">勤務予定日</label><input id="schedule-date" name="date" type="date" value="${escapeHtml(today)}" required ${disabled ? 'disabled' : ''}></div><div class="field"><label for="schedule-start">予定開始時刻</label><input id="schedule-start" name="start" type="time" required ${disabled ? 'disabled' : ''}></div><div class="field"><label for="schedule-end">予定終了時刻</label><input id="schedule-end" name="end" type="time" required ${disabled ? 'disabled' : ''}></div><button class="button primary" type="submit" ${drivers.length && !disabled ? '' : 'disabled'}>予定を登録・更新</button></form><div class="schedule-list" data-schedule-pagination>${scheduleRows || '<div class="empty">勤務予定日はまだありません</div>'}</div></section>`;
}

export function renderEntry({ state, currentUser, today, templates, remoteMode }) {
  const defaultDriver = currentUser.role === 'ドライバー' ? currentUser.id : (state.users.find((user) => user.role === 'ドライバー')?.id || '');
  const options = state.users.filter((user) => user.role === 'ドライバー').map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === defaultDriver ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('');
  return renderTemplate(templates, 'entry', {
    TODAY: today,
    DRIVER_OPTIONS: options || '<option value="">管理画面でドライバーを追加</option>',
    TRACKER_DRIVER_OPTIONS: options || '<option value="">管理画面でドライバーを追加</option>',
    TRACKER_DRIVER_DISABLED: currentUser.role === 'ドライバー' ? 'disabled' : '',
    SCHEDULE_CONTROLS: renderScheduleControls({ state, currentUser, today, remoteMode })
  });
}

function clockTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function minutesSince(startedAt, now) {
  return Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 60000));
}

function activeShiftFor(state, userId) {
  return (state.activeShifts || []).find((shift) => shift.userId === userId);
}

function trackerStatus(shift, now) {
  if (!shift) {
    return '<div class="tracker-idle"><strong>勤務開始前</strong><span>勤務開始ボタンを押すと時刻を記録します。</span><button class="button primary tracker-start" data-tracker-action="start">勤務開始</button></div>';
  }

  const breakMinutes = Number(shift.breakMinutes || 0) + (shift.activity === 'break' ? minutesSince(shift.activityStartedAt, now) : 0);
  const waitMinutes = Number(shift.waitMinutes || 0) + (shift.activity === 'wait' ? minutesSince(shift.activityStartedAt, now) : 0);
  const activityLabel = shift.activity === 'break' ? '休憩中' : shift.activity === 'wait' ? '荷待ち中' : '勤務中';
  const activityAction = shift.activity === 'break'
    ? '<button class="button tracker-action tracker-break" data-tracker-action="end-break">休憩終了</button>'
    : shift.activity === 'wait'
      ? '<button class="button tracker-action tracker-wait" data-tracker-action="end-wait">荷待ち終了</button>'
      : '<button class="button tracker-action tracker-break" data-tracker-action="start-break">休憩開始</button><button class="button tracker-action tracker-wait" data-tracker-action="start-wait">荷待ち開始</button>';

  return `<div class="tracker-running"><div class="tracker-summary"><span class="tracker-state">${activityLabel}</span><span>開始 ${escapeHtml(shift.start)}</span><span>休憩 ${formatHours(breakMinutes)} h</span><span>荷待ち ${formatHours(waitMinutes)} h</span></div><div class="tracker-actions">${activityAction}<button class="button tracker-finish" data-tracker-action="finish">勤務終了</button></div></div>`;
}

function duplicateCount(state, entry) {
  return state.records.filter((record) => record.userId === entry.userId && record.date === entry.date).length;
}

function confirmRecordSave(entry, stats, duplicates, driverName) {
  const duplicateWarning = duplicates
    ? `\n\n注意: 同じドライバー・勤務日に ${duplicates} 件の記録があります。`
    : '';
  return window.confirm(
    `この内容で勤務記録を保存しますか？\nドライバー: ${driverName}\n勤務日: ${entry.date}\n勤務時間: ${entry.start}〜${entry.end}\n実働: ${formatHours(stats.work)} 時間\n休憩: ${formatHours(entry.breakMinutes)} 時間\n荷待ち: ${formatHours(entry.waitMinutes)} 時間\n\n保存後は管理者の承認待ちになります。${duplicateWarning}`
  );
}

export function bindEntry({ state, currentUser, persist, navigate, showToast, render, remoteMode }) {
  if (currentUser.role === '管理者') {
    const scheduleForm = document.getElementById('schedule-form');
    setupPagination(document.querySelector('[data-schedule-pagination]'), '.schedule-row');
    const reloadRemoteState = async () => {
      const latestState = await loadRemoteState();
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, latestState);
    };

    scheduleForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(scheduleForm);
      const userId = String(data.get('userId'));
      const date = String(data.get('date'));
      const start = String(data.get('start'));
      const end = String(data.get('end'));
      if (!state.users.some((user) => user.id === userId && user.role === 'ドライバー')) return showToast('ドライバーを選択してください');
      const parsedDate = new Date(`${date}T00:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || localDateString(parsedDate) !== date) {
        return showToast('勤務予定日を確認してください');
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return showToast('予定の開始・終了時刻を確認してください');
      try {
        if (remoteMode) {
          const client = await getSupabaseClient();
          const { error } = await client.from('work_schedules').upsert(
            { user_id: userId, work_date: date, start_time: start, end_time: end },
            { onConflict: 'user_id,work_date' }
          );
          if (error) throw error;
          await reloadRemoteState();
        } else {
          state.workSchedules ||= [];
          const existing = state.workSchedules.find((schedule) => schedule.userId === userId && schedule.date === date);
          if (existing) Object.assign(existing, { start, end });
          else state.workSchedules.push({ userId, date, start, end });
          if (!await persist()) return;
        }
        render();
        showToast('勤務予定を登録しました');
      } catch (error) {
        console.error('勤務予定を登録できませんでした。', error);
        showToast(`勤務予定の登録に失敗しました: ${error.message}`);
      }
    });

    document.querySelectorAll('[data-delete-schedule]').forEach((button) => button.addEventListener('click', async () => {
      const userId = button.dataset.deleteSchedule;
      const date = button.dataset.scheduleDate;
      if (!window.confirm(`${date} の勤務予定を削除しますか？`)) return;
      try {
        if (remoteMode) {
          const client = await getSupabaseClient();
          const { error } = await client.from('work_schedules').delete().eq('user_id', userId).eq('work_date', date);
          if (error) throw error;
          await reloadRemoteState();
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
  }

  const recordDate = document.getElementById('record-date');
  const driverId = document.getElementById('driver-id');
  const startTime = document.getElementById('start-time');
  const endTime = document.getElementById('end-time');
  const scheduleHint = document.getElementById('schedule-prefill-hint');
  let startEdited = false;
  let endEdited = false;
  let autoStart = '';
  let autoEnd = '';
  startTime.addEventListener('input', () => { startEdited = true; });
  endTime.addEventListener('input', () => { endEdited = true; });
  const applyScheduledTimes = () => {
    const schedule = scheduleForDate(state, driverId.value, recordDate.value);
    if (schedule?.start && schedule?.end) {
      if (!startEdited) startTime.value = schedule.start;
      if (!endEdited) endTime.value = schedule.end;
      autoStart = schedule.start;
      autoEnd = schedule.end;
      scheduleHint.textContent = `勤務予定の時刻（${schedule.start}〜${schedule.end}）を入力しました。手動で修正した時刻はそのまま保持します。`;
      scheduleHint.hidden = false;
      return;
    }
    if (!startEdited && autoStart && startTime.value === autoStart) startTime.value = '08:00';
    if (!endEdited && autoEnd && endTime.value === autoEnd) endTime.value = '17:00';
    autoStart = '';
    autoEnd = '';
    if (schedule) {
      scheduleHint.textContent = 'この勤務予定には時刻が登録されていないため、実績時刻は自動入力されません。';
      scheduleHint.hidden = false;
      return;
    }
    scheduleHint.hidden = true;
  };
  recordDate.addEventListener('change', applyScheduledTimes);
  driverId.addEventListener('change', applyScheduledTimes);
  document.getElementById('record-form').addEventListener('reset', () => {
    startEdited = false;
    endEdited = false;
    window.setTimeout(applyScheduledTimes);
  });
  applyScheduledTimes();

  const trackerDriver = document.getElementById('tracker-driver');
  const trackerStatusElement = document.getElementById('tracker-status');
  const updateTracker = () => {
    const shift = activeShiftFor(state, trackerDriver.value);
    trackerStatusElement.innerHTML = trackerStatus(shift, new Date());
  };

  trackerDriver.addEventListener('change', updateTracker);
  updateTracker();

  trackerStatusElement.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-tracker-action]');
    if (!button) return;

    const userId = trackerDriver.value;
    if (!userId || !state.users.some((user) => user.id === userId && user.role === 'ドライバー')) {
      showToast('ドライバーを選択してください');
      return;
    }

    const action = button.dataset.trackerAction;
    const now = new Date();
    state.activeShifts ||= [];
    let shift = activeShiftFor(state, userId);

    if (action === 'start') {
      if (shift) return;
      shift = {
        userId,
        startedAt: now.toISOString(),
        start: clockTime(now),
        breakMinutes: 0,
        waitMinutes: 0,
        activity: null,
        activityStartedAt: null
      };
      state.activeShifts.push(shift);
      if (!await persist()) return;
      updateTracker();
      refreshShiftReminder(state, currentUser);
      showToast('勤務を開始しました');
      return;
    }

    if (!shift) return;

    if (action === 'start-break' || action === 'start-wait') {
      if (shift.activity) return;
      shift.activity = action === 'start-break' ? 'break' : 'wait';
      shift.activityStartedAt = now.toISOString();
      if (!await persist()) return;
      updateTracker();
      showToast(action === 'start-break' ? '休憩を開始しました' : '荷待ちを開始しました');
      return;
    }

    if (action === 'end-break' || action === 'end-wait') {
      const activity = action === 'end-break' ? 'break' : 'wait';
      if (shift.activity !== activity) return;
      shift[activity === 'break' ? 'breakMinutes' : 'waitMinutes'] += minutesSince(shift.activityStartedAt, now);
      shift.activity = null;
      shift.activityStartedAt = null;
      if (!await persist()) return;
      updateTracker();
      showToast(activity === 'break' ? '休憩を記録しました' : '荷待ちを記録しました');
      return;
    }

    if (action === 'finish') {
      const completedShift = { ...shift };
      if (completedShift.activity === 'break') {
        completedShift.breakMinutes += minutesSince(completedShift.activityStartedAt, now);
      } else if (completedShift.activity === 'wait') {
        completedShift.waitMinutes += minutesSince(completedShift.activityStartedAt, now);
      }

      const entry = {
        userId,
        date: localDateString(new Date(completedShift.startedAt)),
        start: completedShift.start,
        end: clockTime(now),
        breakMinutes: completedShift.breakMinutes,
        waitMinutes: completedShift.waitMinutes,
        note: ''
      };
      const stats = recordStats(entry);
      if (stats.span <= 0 || stats.work <= 0) {
        showToast('勤務開始から1分以上経過してから終了してください');
        return;
      }
      if (entry.waitMinutes > stats.work) {
        showToast('荷待ち時間が勤務時間を超えています');
        return;
      }

      if (!confirmRecordSave(entry, stats, duplicateCount(state, entry), state.users.find((user) => user.id === userId).name)) return;
      const record = { ...entry, id: crypto.randomUUID(), createdAt: now.getTime(), status: 'pending' };
      state.records.push(record);
      logRecordChange(state, record, currentUser, '勤務記録を作成');
      state.activeShifts = state.activeShifts.filter((activeShift) => activeShift.userId !== userId);
      if (!await persist()) return;
      updateTracker();
      refreshShiftReminder(state, currentUser);
      showToast('勤務実績を保存しました');
      navigate('records');
    }
  });

  const form = document.getElementById('record-form');
  const update = () => {
    const data = new FormData(form);
    const span = minutesBetween(data.get('start'), data.get('end'));
    const rest = Number(data.get('breakMinutes') || 0);
    const wait = Number(data.get('waitMinutes') || 0);
    const work = Math.max(span - rest, 0);
    const rate = work ? Math.max(0, (work - wait) / work) : 0;
    document.getElementById('calc-span').textContent = `${formatHours(span)} h`;
    document.getElementById('calc-break').textContent = `${formatHours(rest)} h`;
    document.getElementById('calc-work').textContent = `${formatHours(work)} h`;
    document.getElementById('calc-wait').textContent = `${formatHours(wait)} h`;
    document.getElementById('calc-rate').textContent = `${Math.round(rate * 100)}%`;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('reset', () => setTimeout(update));
  update();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const entry = Object.fromEntries(data.entries());
    entry.breakMinutes = Number(entry.breakMinutes || 0);
    entry.waitMinutes = Number(entry.waitMinutes || 0);
    const stats = recordStats(entry);
    if (!entry.userId || !state.users.some((user) => user.id === entry.userId)) return showToast('ドライバーを選択してください');
    if (stats.span <= 0 || stats.work <= 0) return showToast('勤務時間と休憩時間を確認してください');
    if (entry.waitMinutes > stats.work) return showToast('荷待ち時間は実働時間以内で入力してください');
    if (!confirmRecordSave(entry, stats, duplicateCount(state, entry), state.users.find((user) => user.id === entry.userId).name)) return;
    const record = { ...entry, id: crypto.randomUUID(), createdAt: Date.now(), status: 'pending' };
    state.records.push(record);
    logRecordChange(state, record, currentUser, '勤務記録を作成');
    if (!await persist()) return;
    navigate('records');
    showToast('勤務実績を保存しました');
  });
}