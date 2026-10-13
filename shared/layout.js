import { NAV_ITEMS, escapeHtml } from './data.js';
import { renderTemplate } from './templates.js';

function navMarkup(currentScreen) {
  return NAV_ITEMS.map((item) => `<button class="nav-item ${currentScreen === item.id ? 'active' : ''}" data-screen="${item.id}"><span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`).join('');
}

export function appFrame(content, { currentScreen, currentUser, templates }) {
  const initials = currentUser.name.replace(/\s/g, '').slice(0, 1);
  return renderTemplate(templates, 'shell', {
    NAV: navMarkup(currentScreen),
    CURRENT_LABEL: NAV_ITEMS.find((item) => item.id === currentScreen)?.label || '',
    CURRENT_DATE: new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date()),
    INITIAL: escapeHtml(initials),
    USER_NAME: escapeHtml(currentUser.name),
    USER_ROLE: escapeHtml(currentUser.role),
    CONTENT: content
  });
}