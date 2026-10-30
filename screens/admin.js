import { escapeHtml, formatDate, localDateString } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';
import { getSupabaseClient, loadRemoteState } from '../shared/supabase.js';

export function renderAdmin({ state, currentUser, today, templates, remoteMode }) {
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
  const drivers = state.users.filter((user) => user.role === 'ドライバー');
  const scheduleOptions = drivers.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}</option>`).join('');
  const scheduleRows = [...(state.workSchedules || [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((schedule) => {
      const user = drivers.find((item) => item.id === schedule.userId);
      if (!user) return '';
      const recorded = state.records.some((record) => record.userId === schedule.userId && record.date === schedule.date);
      const status = recorded ? '記録済み' : schedule.date < today ? '未入力' : schedule.date === today ? '本日' : '予定';
      return `<div class="schedule-row"><div class="schedule-row-info"><span class="schedule-row-date">${escapeHtml(user.name)} · ${escapeHtml(formatDate(schedule.date))}</span><span class="schedule-row-status">${status}</span></div><button class="button danger small" type="button" data-delete-schedule="${escapeHtml(schedule.userId)}" data-schedule-date="${escapeHtml(schedule.date)}">削除</button></div>`;
    }).join('');
  const scheduleTableUnavailable = remoteMode && state.workSchedulesAvailable === false;
  return renderTemplate(templates, 'admin', {
    USER_COUNT: state.users.length,
    USER_ROWS: usersMarkup || '<div class="empty">ユーザーはいません</div>',
    SCHEDULE_CONTROLS: `<article class="panel schedule-panel"><div class="panel-heading"><h2 class="panel-title">ドライバーの勤務予定</h2></div>${scheduleTableUnavailable ? '<p class="schedule-setup-warning" role="alert">勤務予定テーブルがまだ作成されていません。Supabase の SQL Editor で <code>supabase/schedule-migration.sql</code> を実行すると、この機能を利用できます。</p>' : ''}<p class="subtitle">登録した勤務日の翌日以降、記録が未入力の場合に本人の画面へお知らせします。</p><form id="schedule-form"><div class="field field-spaced"><label for="schedule-driver">ドライバー</label><select id="schedule-driver" name="userId" required ${scheduleTableUnavailable ? 'disabled' : ''}>${scheduleOptions || '<option value="">ドライバーがいません</option>'}</select></div><div class="field"><label for="schedule-date">勤務予定日</label><input id="schedule-date" name="date" type="date" required ${scheduleTableUnavailable ? 'disabled' : ''}></div><div class="form-actions"><button class="button primary" type="submit" ${drivers.length && !scheduleTableUnavailable ? '' : 'disabled'}>予定日を追加</button></div></form><div class="schedule-list">${scheduleRows || '<div class="empty">勤務予定日はまだありません</div>'}</div></article>`,
    ADMIN_CONTROLS: remoteMode
      ? '<article class="panel"><div class="panel-heading"><h2 class="panel-title">アカウントを追加</h2></div><form id="user-form"><div class="field field-spaced"><label for="new-user-name">表示名 *</label><input id="new-user-name" name="name" maxlength="40" placeholder="例: 山田 太郎" required></div><div class="field field-spaced"><label for="new-user-email">メールアドレス *</label><input id="new-user-email" name="email" type="email" autocomplete="off" required></div><div class="field field-spaced"><label for="new-user-role">役割 *</label><select id="new-user-role" name="role"><option>ドライバー</option><option>管理者</option></select></div><div class="field"><label for="new-user-password">初期パスワード（8文字以上）*</label><input id="new-user-password" name="password" type="password" minlength="8" autocomplete="new-password" required></div><div class="form-actions"><button class="button primary" type="submit">アカウントを作成</button></div></form><div class="demo-note">確認メールは送信せず、ここで設定した初期パスワードですぐログインできます。初期パスワードは本人へ安全な方法で伝えてください。</div></article>'
      : '<article class="panel"><div class="panel-heading"><h2 class="panel-title">ユーザーを追加</h2></div><form id="user-form"><div class="field field-spaced"><label for="new-user-name">氏名 *</label><input id="new-user-name" name="name" maxlength="40" placeholder="例: 山田 太郎" required></div><div class="field"><label for="new-user-role">役割 *</label><select id="new-user-role" name="role"><option>ドライバー</option><option>管理者</option></select></div><div class="form-actions"><button class="button primary" type="submit">ユーザーを追加</button></div></form><div class="demo-note">デモユーザーはこの端末だけに保存されます。</div></article>'
  });
}

export function bindAdmin({ state, currentUser, persist, render, showToast, remoteMode }) {
  if (currentUser.role !== '管理者') return;
  const scheduleForm = document.getElementById('schedule-form');
  const reloadRemoteState = async () => {
    const latestState = await loadRemoteState();
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, latestState);
  };
  const saveSchedule = async (userId, date) => {
    if (remoteMode) {
      const client = await getSupabaseClient();
      const { error } = await client.from('work_schedules').upsert(
        { user_id: userId, work_date: date },
        { onConflict: 'user_id,work_date' }
      );
      if (error) throw error;
      await reloadRemoteState();
    } else {
      state.workSchedules ||= [];
      if (!state.workSchedules.some((item) => item.userId === userId && item.date === date)) {
        state.workSchedules.push({ userId, date });
      }
      if (!await persist()) return false;
    }
    return true;
  };
  const deleteSchedule = async (userId, date) => {
    if (remoteMode) {
      const client = await getSupabaseClient();
      const { error } = await client.from('work_schedules')
        .delete()
        .eq('user_id', userId)
        .eq('work_date', date);
      if (error) throw error;
      await reloadRemoteState();
    } else {
      state.workSchedules = (state.workSchedules || []).filter((item) => item.userId !== userId || item.date !== date);
      if (!await persist()) return false;
    }
    return true;
  };
  scheduleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(scheduleForm);
    const userId = String(data.get('userId'));
    const date = String(data.get('date'));
    if (!state.users.some((user) => user.id === userId && user.role === 'ドライバー')) {
      showToast('ドライバーを選択してください');
      return;
    }
    const parsedDate = new Date(`${date}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || localDateString(parsedDate) !== date) {
      showToast('勤務予定日を確認してください');
      return;
    }
    if ((state.workSchedules || []).some((item) => item.userId === userId && item.date === date)) {
      showToast('この勤務予定日は登録済みです');
      return;
    }
    try {
      if (!await saveSchedule(userId, date)) return;
      render();
      showToast('勤務予定日を登録しました');
    } catch (error) {
      console.error('勤務予定日を登録できませんでした。', error);
      showToast(`勤務予定日の登録に失敗しました: ${error.message}`);
    }
  });
  document.querySelectorAll('[data-delete-schedule]').forEach((button) => button.addEventListener('click', async () => {
    const userId = button.dataset.deleteSchedule;
    const date = button.dataset.scheduleDate;
    if (!window.confirm(`${date} の勤務予定を削除しますか？`)) return;
    try {
      if (!await deleteSchedule(userId, date)) return;
      render();
      showToast('勤務予定日を削除しました');
    } catch (error) {
      console.error('勤務予定日を削除できませんでした。', error);
      showToast(`勤務予定日の削除に失敗しました: ${error.message}`);
    }
  }));
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
    state.workSchedules = (state.workSchedules || []).filter((schedule) => schedule.userId !== button.dataset.deleteUser);
    if (!await persist()) return;
    render();
    showToast('ユーザーを削除しました');
  }));
}