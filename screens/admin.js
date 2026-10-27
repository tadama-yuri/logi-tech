import { escapeHtml } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';
import { getSupabaseClient, loadRemoteState } from '../shared/supabase.js';

export function renderAdmin({ state, currentUser, templates, remoteMode }) {
  if (currentUser.role !== '管理者') {
    return '<section class="page"><article class="panel"><h1>権限がありません</h1><p class="subtitle">ユーザー管理は管理者のみ利用できます。</p></article></section>';
  }

  const usersMarkup = state.users.map((user) => {
    const active = (state.activeShifts || []).some((shift) => shift.userId === user.id);
    const disabled = user.id === currentUser.id || active;
    const reason = user.id === currentUser.id ? 'ログイン中のユーザーは削除できません' : '勤務中のユーザーは削除できません';
    const deleteButton = remoteMode ? '' : `<button class="button danger small" data-delete-user="${escapeHtml(user.id)}" ${disabled ? `disabled title="${reason}"` : ''}>削除</button>`;
    return `<div class="activity-row"><div class="user-row-info"><div class="avatar">${escapeHtml(user.name.replace(/\s/g, '').slice(0, 1))}</div><div><div class="activity-person">${escapeHtml(user.name)}</div><div class="activity-sub">${escapeHtml(user.role)} · ${state.records.filter((record) => record.userId === user.id).length} 件の記録${active ? ' · 勤務中' : ''}</div></div></div>${deleteButton}</div>`;
  }).join('');
  return renderTemplate(templates, 'admin', {
    USER_COUNT: state.users.length,
    USER_ROWS: usersMarkup || '<div class="empty">ユーザーはいません</div>',
    ADMIN_CONTROLS: remoteMode
      ? '<article class="panel"><div class="panel-heading"><h2 class="panel-title">アカウントを追加</h2></div><form id="user-form"><div class="field field-spaced"><label for="new-user-name">表示名 *</label><input id="new-user-name" name="name" maxlength="40" placeholder="例: 山田 太郎" required></div><div class="field field-spaced"><label for="new-user-email">メールアドレス *</label><input id="new-user-email" name="email" type="email" autocomplete="off" required></div><div class="field field-spaced"><label for="new-user-role">役割 *</label><select id="new-user-role" name="role"><option>ドライバー</option><option>管理者</option></select></div><div class="field"><label for="new-user-password">初期パスワード（8文字以上）*</label><input id="new-user-password" name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="form-actions"><button class="button primary" type="submit">アカウントを作成</button></div></form><div class="demo-note">確認メールは送信せず、ここで設定した初期パスワードですぐログインできます。初期パスワードは本人へ安全な方法で伝えてください。</div></article>'
      : '<article class="panel"><div class="panel-heading"><h2 class="panel-title">ユーザーを追加</h2></div><form id="user-form"><div class="field field-spaced"><label for="new-user-name">氏名 *</label><input id="new-user-name" name="name" maxlength="40" placeholder="例: 山田 太郎" required></div><div class="field"><label for="new-user-role">役割 *</label><select id="new-user-role" name="role"><option>ドライバー</option><option>管理者</option></select></div><div class="form-actions"><button class="button primary" type="submit">ユーザーを追加</button></div></form><div class="demo-note">デモユーザーはこの端末だけに保存されます。</div></article>'
  });
}

export function bindAdmin({ state, currentUser, persist, render, showToast, remoteMode }) {
  if (currentUser.role !== '管理者') return;
  if (remoteMode) {
    document.getElementById('user-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      try {
        const client = await getSupabaseClient();
        const { error } = await client.functions.invoke('create-user', {
          body: {
            email: data.get('email'),
            name: data.get('name'),
            role: data.get('role'),
            password: data.get('password')
          }
        });
        if (error) throw error;
        const latestState = await loadRemoteState();
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, latestState);
        render();
        showToast('アカウントを作成しました');
      } catch (error) {
        console.error('アカウントを作成できませんでした。', error);
        showToast(`アカウント作成に失敗しました: ${error.message}`);
      }
    });
    return;
  }

  document.getElementById('user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (currentUser.role !== '管理者') {
      showToast('ユーザー管理は管理者のみ利用できます');
      return;
    }
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    if (!name) return;
    if (state.users.some((user) => user.name === name)) return showToast('同じ名前のユーザーが登録されています');
    state.users.push({ id: crypto.randomUUID(), name, role: data.get('role') });
    if (!await persist()) return;
    render();
    showToast('ユーザーを追加しました');
  });
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', async () => {
    if (currentUser.role !== '管理者') {
      showToast('ユーザー管理は管理者のみ利用できます');
      return;
    }
    if (button.disabled) return;
    if ((state.activeShifts || []).some((shift) => shift.userId === button.dataset.deleteUser)) return showToast('勤務中のユーザーは削除できません');
    state.users = state.users.filter((user) => user.id !== button.dataset.deleteUser);
    if (!await persist()) return;
    render();
    showToast('ユーザーを削除しました');
  }));
}