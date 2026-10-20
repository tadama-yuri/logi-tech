import { NAV_ITEMS, escapeHtml } from './data.js';
import { renderTemplate } from './templates.js';

function visibleNavItems(currentUser) {
  return NAV_ITEMS.filter((item) => item.id !== 'admin' || currentUser.role === '運行管理者');
}

function navMarkup(currentScreen, items) {
  return items.map((item) => `<button class="nav-item ${currentScreen === item.id ? 'active' : ''}" data-screen="${item.id}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`).join('');
}

export function appFrame(content, { currentScreen, currentUser, templates }) {
  const initials = currentUser.name.replace(/\s/g, '').slice(0, 1);
  const navItems = visibleNavItems(currentUser);
  return renderTemplate(templates, 'shell', {
    NAV: navMarkup(currentScreen, navItems),
    NAV_COLUMN_COUNT: navItems.length,
    CURRENT_LABEL: navItems.find((item) => item.id === currentScreen)?.label || '',
    CURRENT_DATE: new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()),
    INITIAL: escapeHtml(initials),
    USER_NAME: escapeHtml(currentUser.name),
    USER_ROLE: escapeHtml(currentUser.role),
    CONTENT: content
  });
}