import { escapeHtml, formatHours, recordsForToday, totals } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';
import { getSupabaseClient } from '../shared/supabase.js';

export function renderLogin({ state, today, templates, remoteMode }) {
  const options = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}（${escapeHtml(user.role)}）</option>`).join('');
  const sum = totals(recordsForToday(state, today));
  const loginFields = remoteMode
    ? '<div class="field"><label for="login-email">メールアドレス</label><input id="login-email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="login-password">パスワード</label><input id="login-password" name="password" type="password" autocomplete="current-password" required></div>'
    : `<div class="field"><label for="login-user">ユーザー</label><select id="login-user" name="userId" required>${options || '<option value="">ユーザーがありません</option>'}</select></div><div class="demo-note">デモモードです。Supabase の URL と anon key を設定すると、メールアドレスとパスワードで認証します。</div>`;
  return renderTemplate(templates, 'login', {
    RECORD_COUNT: state.records.length,
    WAIT_HOURS: formatHours(sum.wait),
    LOGIN_FIELDS: loginFields,
    LOGIN_PROMPT: remoteMode ? '登録済みのメールアドレスとパスワードを入力してください。' : '試作環境ではユーザーを選んでログインできます。',
    LOGIN_STATS: remoteMode ? '' : `<div class="login-stats"><div class="login-stat"><strong>${state.records.length}</strong><span>保存済み記録</span></div><div class="login-stat"><strong>${formatHours(sum.wait)}h</strong><span>本日の荷待ち</span></div></div>`,
    LOGIN_NOTE: '<div class="login-error" id="login-error" role="alert" hidden></div>'
  });
}

export function bindLogin({ state, onLogin, remoteMode }) {
  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorElement = document.getElementById('login-error');
    let authenticated = false;
    errorElement.hidden = true;
    try {
      if (remoteMode) {
        const data = new FormData(form);
        const client = await getSupabaseClient();
        const { data: result, error } = await client.auth.signInWithPassword({
          email: data.get('email'),
          password: data.get('password')
        });
        if (error) throw error;
        authenticated = true;
        await onLogin(result.user);
      } else {
        await onLogin(state.users.find((user) => user.id === new FormData(form).get('userId')));
      }
    } catch (error) {
      console.error('ログインできませんでした。', error);
      if (remoteMode && authenticated) {
        try {
          const client = await getSupabaseClient();
          const { error: signOutError } = await client.auth.signOut();
          if (signOutError) throw signOutError;
        } catch (signOutError) {
          console.error('ログイン失敗後にセッションを終了できませんでした。', signOutError);
        }
      }
      errorElement.textContent = `ログインできませんでした: ${error.message}`;
      errorElement.hidden = false;
    }
  });
}