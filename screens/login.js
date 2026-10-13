import { escapeHtml, formatHours, recordsForToday, totals } from '../shared/data.js';
import { renderTemplate } from '../shared/templates.js';

export function renderLogin({ state, today, templates }) {
  const options = state.users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)}（${escapeHtml(user.role)}）</option>`).join('');
  const sum = totals(recordsForToday(state, today));
  return renderTemplate(templates, 'login', {
    USER_OPTIONS: options || '<option value="">ユーザーがありません</option>',
    RECORD_COUNT: state.records.length,
    WAIT_HOURS: formatHours(sum.wait)
  });
}

export function bindLogin({ state, onLogin }) {
  document.getElementById('login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    onLogin(state.users.find((user) => user.id === new FormData(event.currentTarget).get('userId')));
  });
}