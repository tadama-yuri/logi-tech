import { escapeHtml } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderAdmin({ state, currentUser, templates }) {
  if (currentUser.role !== '管理者') {
    return '<section class="page"><article class="panel"><h1>権限がありません</h1><p class="subtitle">ユーザー管理は管理者のみ利用できます。</p></article></section>';
  }

  const usersMarkup = state.users.map((user) => {
    const active = (state.activeShifts || []).some((shift) => shift.userId === user.id);
    const disabled = user.id === currentUser.id || active;
    const reason = user.id === currentUser.id ? 'ログイン中のユーザーは削除できません' : '勤務中のユーザーは削除できません';
    return `<div class="activity-row"><div class="user-row-info"><div class="avatar">${escapeHtml(user.name.replace(/\s/g, '').slice(0, 1))}</div><div><div class="activity-person">${escapeHtml(user.name)}</div><div class="activity-sub">${escapeHtml(user.role)} · ${state.records.filter((record) => record.userId === user.id).length} 件の記録${active ? ' · 勤務中' : ''}</div></div></div><button class="button danger small" data-delete-user="${escapeHtml(user.id)}" ${disabled ? `disabled title="${reason}"` : ''}>削除</button></div>`;
  }).join('');
  return renderTemplate(templates, 'admin', {
    USER_COUNT: state.users.length,
    USER_ROWS: usersMarkup || '<div class="empty">ユーザーはいません</div>'
  });
}

export function bindAdmin({ state, currentUser, persist, render, showToast }) {
  if (currentUser.role !== '管理者') return;

  document.getElementById('user-form').addEventListener('submit', (event) => {
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
    persist();
    render();
    showToast('ユーザーを追加しました');
  });
  document.querySelectorAll('[data-delete-user]').forEach((button) => button.addEventListener('click', () => {
    if (currentUser.role !== '管理者') {
      showToast('ユーザー管理は管理者のみ利用できます');
      return;
    }
    if (button.disabled) return;
    if ((state.activeShifts || []).some((shift) => shift.userId === button.dataset.deleteUser)) return showToast('勤務中のユーザーは削除できません');
    state.users = state.users.filter((user) => user.id !== button.dataset.deleteUser);
    persist();
    render();
    showToast('ユーザーを削除しました');
  }));
}