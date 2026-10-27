import { loadState, persist, showToast, localDateString } from './shared/data.js';
import { appFrame } from './shared/layout.js';
import { loadTemplates } from './shared/templates.js';
import { renderAnalytics, bindAnalytics } from './screens/analytics.js';
import { renderEntry, bindEntry } from './screens/entry.js';
import { renderRecords, bindRecords } from './screens/records.js';
import { renderAdmin, bindAdmin } from './screens/admin.js';
import { renderLogin, bindLogin } from './screens/login.js';

const today = localDateString();
const state = loadState();
const templates = await loadTemplates();
let currentUser = null;
let currentScreen = 'login';

const screens = {
  analytics: { render: renderAnalytics, bind: bindAnalytics },
  entry: { render: renderEntry, bind: bindEntry },
  records: { render: renderRecords, bind: bindRecords },
  admin: { render: renderAdmin, bind: bindAdmin }
};

function canAccessScreen(user, screen) {
  if (!user) return false;
  if (screen === 'analytics') return user.role === '管理者';
  if (screen === 'admin') return user.role === '管理者';
  return true;
}

function navigate(screen) {
  if (!screens[screen]) return;
  if (!canAccessScreen(currentUser, screen)) {
    const message = screen === 'analytics'
      ? '稼働分析は管理者のみ閲覧できます'
      : 'この画面へのアクセス権限がありません';
    showToast(message);
    return;
  }
  currentScreen = screen;
  render();
}

function render() {
  const root = document.getElementById('app');
  const navigateToApp = (user) => {
    if (!user) return;
    currentUser = user;
    currentScreen = currentUser.role === 'ドライバー' ? 'entry' : 'analytics';
    render();
  };

  if (!currentUser) {
    root.innerHTML = renderLogin({ state, today, templates });
    bindLogin({ state, onLogin: navigateToApp });
    return;
  }

  if (!canAccessScreen(currentUser, currentScreen)) {
    currentScreen = currentUser.role === 'ドライバー' ? 'entry' : 'analytics';
  }
  const screen = screens[currentScreen] || (currentUser.role === 'ドライバー' ? screens.entry : screens.analytics);
  const context = {
    state,
    today,
    templates,
    currentUser,
    navigate,
    render,
    persist: () => persist(state),
    showToast
  };
  root.innerHTML = appFrame(screen.render(context), { currentScreen, currentUser, templates, state });
  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.screen));
  });
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', () => {
      currentUser = null;
      currentScreen = 'login';
      render();
    });
  });
  screen.bind(context);
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('オフライン機能を有効にできませんでした。', error)));
}

render();