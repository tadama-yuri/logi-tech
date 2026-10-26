import { NAV_ITEMS, escapeHtml } from './data.js';
import { renderTemplate } from './templates.js';

function visibleNavItems(currentUser) {
  return NAV_ITEMS.filter((item) => item.id !== 'admin' || currentUser.role === '運行管理者');
}

function navMarkup(currentScreen, items) {
  return items.map((item) => `<button class="nav-item ${currentScreen === item.id ? 'active' : ''}" data-screen="${item.id}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`).join('');
}

export function refreshShiftReminder(state, currentUser) {
  const reminder = document.getElementById('active-shift-reminder');
  if (!reminder) return;
  const shifts = (state.activeShifts || []).filter((shift) => currentUser.role !== 'ドライバー' || shift.userId === currentUser.id);
  reminder.hidden = shifts.length === 0;
  reminder.querySelector('[data-reminder-message]').textContent = `勤務中のままの記録が ${shifts.length} 件あります。勤務を終了して記録を確定してください。`;
}

export function appFrame(content, { currentScreen, currentUser, templates, state }) {
  const initials = currentUser.name.replace(/\s/g, '').slice(0, 1);
  const navItems = visibleNavItems(currentUser);
  const activeShifts = (state.activeShifts || []).filter((shift) => currentUser.role !== 'ドライバー' || shift.userId === currentUser.id);
  return renderTemplate(templates, 'shell', {
    NAV: navMarkup(currentScreen, navItems),
    NAV_COLUMN_COUNT: navItems.length,
    CURRENT_LABEL: navItems.find((item) => item.id === currentScreen)?.label || '',
    CURRENT_DATE: new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()),
    INITIAL: escapeHtml(initials),
    USER_NAME: escapeHtml(currentUser.name),
    USER_ROLE: escapeHtml(currentUser.role),
    SHIFT_REMINDER: activeShifts.length
      ? `<div class="shift-reminder" id="active-shift-reminder" role="status"><span data-reminder-message>勤務中のままの記録が ${activeShifts.length} 件あります。勤務を終了して記録を確定してください。</span><button type="button" class="button ghost small" data-screen="entry">勤務記録を確認</button></div>`
      : '<div class="shift-reminder" id="active-shift-reminder" role="status" hidden><span data-reminder-message></span><button type="button" class="button ghost small" data-screen="entry">勤務記録を確認</button></div>',
    CONTENT: content
  });
}