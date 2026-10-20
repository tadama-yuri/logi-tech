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

function navigate(screen) {
  if (!screens[screen]) return;
  if (screen === 'admin' && currentUser?.role !== '運行管理者') {
    showToast('ユーザー管理は運行管理者のみ利用できます');
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
    currentScreen = 'analytics';
    render();
  };

  if (!currentUser) {
    root.innerHTML = renderLogin({ state, today, templates });
    bindLogin({ state, onLogin: navigateToApp });
    return;
  }

  if (currentScreen === 'admin' && currentUser.role !== '運行管理者') currentScreen = 'analytics';
  const screen = screens[currentScreen] || screens.analytics;
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
  root.innerHTML = appFrame(screen.render(context), { currentScreen, currentUser, templates });
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