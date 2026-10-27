import { loadState, persist, showToast, localDateString } from './shared/data.js';
import { appFrame } from './shared/layout.js';
import { loadTemplates } from './shared/templates.js';
import { isSupabaseConfigured } from './shared/supabase-config.js';
import { getSupabaseClient, loadRemoteState, persistRemoteState } from './shared/supabase.js';
import { renderAnalytics, bindAnalytics } from './screens/analytics.js';
import { renderEntry, bindEntry } from './screens/entry.js';
import { renderRecords, bindRecords } from './screens/records.js';
import { renderAdmin, bindAdmin } from './screens/admin.js';
import { renderLogin, bindLogin } from './screens/login.js';

const today = localDateString();
const remoteMode = isSupabaseConfigured();
let state = remoteMode
  ? { users: [], activeShifts: [], records: [], auditLog: [] }
  : loadState();
let templates;
let currentUser = null;
let currentScreen = 'login';

function replaceState(nextState) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, nextState);
}

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
  const navigateToApp = async (user) => {
    if (!user) return;
    if (remoteMode) {
      const remoteState = await loadRemoteState();
      const profile = remoteState.users.find((item) => item.id === user.id);
      if (!profile) {
        const client = await getSupabaseClient();
        await client.auth.signOut();
        throw new Error('ユーザープロフィールがありません。Supabase の profiles テーブルを確認してください。');
      }
      state = remoteState;
      currentUser = profile;
    } else {
      currentUser = user;
    }
    currentScreen = currentUser.role === 'ドライバー' ? 'entry' : 'analytics';
    render();
  };

  if (!currentUser) {
    root.innerHTML = renderLogin({ state, today, templates, remoteMode });
    bindLogin({ state, onLogin: navigateToApp, remoteMode });
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
    persist: async () => {
      try {
        if (remoteMode) {
          replaceState(await persistRemoteState(state));
        } else {
          persist(state);
        }
        return true;
      } catch (error) {
        console.error('データを保存できませんでした。', error);
        showToast(`保存に失敗しました: ${error.message}`);
        try {
          replaceState(remoteMode ? await loadRemoteState() : loadState());
        } catch (reloadError) {
          console.error('最新データを再読み込みできませんでした。', reloadError);
          showToast('最新データの再読み込みにも失敗しました。ページを再読み込みしてください。');
        }
        render();
        return false;
      }
    },
    storageNote: remoteMode ? 'データは Supabase に保存されます。' : 'データはこの端末に保存されています。<br>試作環境・同期なし',
    remoteMode,
    showToast
  };
  root.innerHTML = appFrame(screen.render(context), {
    currentScreen, currentUser, templates, state, storageNote: context.storageNote
  });
  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.addEventListener('click', () => navigate(button.dataset.screen));
  });
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', () => {
      (async () => {
        if (remoteMode) {
          try {
            const client = await getSupabaseClient();
            const { error } = await client.auth.signOut();
            if (error) throw error;
          } catch (error) {
            console.error('ログアウトできませんでした。', error);
            showToast(`ログアウトできませんでした: ${error.message}`);
            return;
          }
        }
        currentUser = null;
        currentScreen = 'login';
        replaceState(remoteMode ? { users: [], activeShifts: [], records: [], auditLog: [] } : loadState());
        render();
      })();
    });
  });
  screen.bind(context);
}

async function start() {
  templates = await loadTemplates();
  if (remoteMode) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) {
      await (async () => {
        const remoteState = await loadRemoteState();
        const profile = remoteState.users.find((item) => item.id === data.session.user.id);
        if (!profile) {
          const { error: signOutError } = await client.auth.signOut();
          if (signOutError) console.error('プロフィール不在のセッションを終了できませんでした。', signOutError);
          throw new Error('ユーザープロフィールがありません。Supabase の profiles テーブルを確認してください。');
        }
        state = remoteState;
        currentUser = profile;
        currentScreen = currentUser.role === 'ドライバー' ? 'entry' : 'analytics';
      })();
    }
  }
  render();
}

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('オフライン機能を有効にできませんでした。', error)));
}

start().catch((error) => {
  console.error('アプリを起動できませんでした。', error);
  const root = document.getElementById('app');
  root.innerHTML = '<section class="page"><article class="panel"><h1>アプリを起動できませんでした</h1><p id="startup-error"></p></article></section>';
  root.querySelector('#startup-error').textContent = error.message;
});