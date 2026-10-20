import { escapeHtml, formatHours, localDateString, minutesBetween, recordStats } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderEntry({ state, currentUser, today, templates }) {
  const defaultDriver = currentUser.role === 'ドライバー' ? currentUser.id : (state.users.find((user) => user.role === 'ドライバー')?.id || '');
  const options = state.users.filter((user) => user.role === 'ドライバー').map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === defaultDriver ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('');
  return renderTemplate(templates, 'entry', {
    TODAY: today,
    DRIVER_OPTIONS: options || '<option value="">管理画面でドライバーを追加</option>',
    TRACKER_DRIVER_OPTIONS: options || '<option value="">管理画面でドライバーを追加</option>',
    TRACKER_DRIVER_DISABLED: currentUser.role === 'ドライバー' ? 'disabled' : ''
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

export function bindEntry({ state, persist, navigate, showToast }) {
  const trackerDriver = document.getElementById('tracker-driver');
  const trackerStatusElement = document.getElementById('tracker-status');
  const updateTracker = () => {
    const shift = activeShiftFor(state, trackerDriver.value);
    trackerStatusElement.innerHTML = trackerStatus(shift, new Date());
  };

  trackerDriver.addEventListener('change', updateTracker);
  updateTracker();

  trackerStatusElement.addEventListener('click', (event) => {
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
      persist();
      updateTracker();
      showToast('勤務を開始しました');
      return;
    }

    if (!shift) return;

    if (action === 'start-break' || action === 'start-wait') {
      if (shift.activity) return;
      shift.activity = action === 'start-break' ? 'break' : 'wait';
      shift.activityStartedAt = now.toISOString();
      persist();
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
      persist();
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

      state.records.push({ ...entry, id: crypto.randomUUID(), createdAt: now.getTime() });
      state.activeShifts = state.activeShifts.filter((activeShift) => activeShift.userId !== userId);
      persist();
      updateTracker();
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
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const entry = Object.fromEntries(data.entries());
    entry.breakMinutes = Number(entry.breakMinutes || 0);
    entry.waitMinutes = Number(entry.waitMinutes || 0);
    const stats = recordStats(entry);
    if (!entry.userId || !state.users.some((user) => user.id === entry.userId)) return showToast('ドライバーを選択してください');
    if (stats.span <= 0 || stats.work <= 0) return showToast('勤務時間と休憩時間を確認してください');
    if (entry.waitMinutes > stats.work) return showToast('荷待ち時間は実働時間以内で入力してください');
    state.records.push({ ...entry, id: crypto.randomUUID(), createdAt: Date.now() });
    persist();
    navigate('records');
    showToast('勤務実績を保存しました');
  });
}