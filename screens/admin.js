import { escapeHtml } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderAdmin({ state, currentUser, templates }) {
  const usersMarkup = state.users.map((user) => `<div class="activity-row"><div class="user-row-info"><div class="avatar">${escapeHtml(user.name.replace(/\s/g, '').slice(0, 1))}</div><div><div class="activity-person">${escapeHtml(user.name)}</div><div class="activity-sub">${escapeHtml(user.role)} · ${state.records.filter((record) => record.userId === user.id).length} 件の記録</div></div></div><button class="button danger small" data-delete-user="${escapeHtml(user.id)}" ${user.id === currentUser.id ? 'disabled title="ログイン中のユーザーは削除できません"' : ''}>削除</button></div>`).join('');
  return renderTemplate(templates, 'admin', {
    USER_COUNT: state.users.length,
    USER_ROWS: usersMarkup || '<div class="empty">ユーザーはいません</div>'
  });
}

export function bindAdmin({ state, currentUser, persist, render, showToast }) {
  document.getElementById('user-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name')).trim();
    if (!name) return;
    if (state.users.some((user) => user.name === name)) return showToast('同じ名前のユーザーが登録されています');
    state.users.push({ id: crypto.randomUUID(), name, role: data.get('role') });
    persist();
    render();
    showToast('ユーザーを追加しました');
  });
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', () => {
    if (button.disabled) return;
    state.users = state.users.filter((user) => user.id !== button.dataset.deleteUser);
    persist();
    render();
    showToast('ユーザーを削除しました');
  }));
}