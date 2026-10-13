import { escapeHtml, formatHours, minutesBetween, recordStats } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderEntry({ state, currentUser, today, templates }) {
  const defaultDriver = currentUser.role === 'ドライバー' ? currentUser.id : (state.users.find((user) => user.role === 'ドライバー')?.id || '');
  const options = state.users.filter((user) => user.role === 'ドライバー').map((user) => `<option value="${escapeHtml(user.id)}" ${user.id === defaultDriver ? 'selected' : ''}>${escapeHtml(user.name)}</option>`).join('');
  return renderTemplate(templates, 'entry', {
    TODAY: today,
    DRIVER_OPTIONS: options || '<option value="">管理画面でドライバーを追加</option>'
  });
}

export function bindEntry({ state, persist, navigate, showToast }) {
  const form = document.getElementById('record-form');
  const update = () => {
    const data = new FormData(form);
    const span = minutesBetween(data.get('start'), data.get('end'));
    const rest = Number(data.get('breakMinutes') || 0);
    const wait = Number(data.get('waitMinutes') || 0);
    const work = Math.max(span - rest, 0);
    const rate = work ? Math.max(0, (work - wait) / work) : 0;
    document.getElementById('calc-span').textContent = `${formatHours(span)} h`;
    document.getElementById('calc-break').textContent = `${formatHours(rest)} h`;
    document.getElementById('calc-work').textContent = `${formatHours(work)} h`;
    document.getElementById('calc-wait').textContent = `${formatHours(wait)} h`;
    document.getElementById('calc-rate').textContent = `${Math.round(rate * 100)}%`;
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('reset', () => setTimeout(update));
  update();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const entry = Object.fromEntries(data.entries());
    entry.breakMinutes = Number(entry.breakMinutes || 0);
    entry.waitMinutes = Number(entry.waitMinutes || 0);
    const stats = recordStats(entry);
    if (!entry.userId || !state.users.some((user) => user.id === entry.userId)) return showToast('ドライバーを選択してください');
    if (stats.span <= 0 || stats.work <= 0) return showToast('勤務時間と休憩時間を確認してください');
    if (entry.waitMinutes > stats.work) return showToast('荷待ち時間は実働時間以内で入力してください');
    state.records.push({ ...entry, id: crypto.randomUUID(), createdAt: Date.now() });
    persist();
    navigate('records');
    showToast('勤務実績を保存しました');
  });
}