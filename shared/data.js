const STORE_KEY = 'souroku-data-v1';

const DEFAULT_USERS = [
  { id: 'u1', name: '吉田 直人', role: '管理者' },
  { id: 'u2', name: '佐藤 健', role: 'ドライバー' },
  { id: 'u3', name: '高橋 亮', role: 'ドライバー' }
];

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const today = localDateString();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);

const sampleData = {
  users: DEFAULT_USERS,
  activeShifts: [],
  records: [
    { id: 'r1', userId: 'u2', date: today, start: '07:30', end: '17:15', breakMinutes: 60, waitMinutes: 95, note: '午前便・午後便', createdAt: Date.now() - 1000 },
    { id: 'r2', userId: 'u3', date: today, start: '08:00', end: '18:30', breakMinutes: 75, waitMinutes: 140, note: 'センターで荷待ち', createdAt: Date.now() - 2000 },
    { id: 'r3', userId: 'u2', date: today, start: '06:45', end: '16:20', breakMinutes: 60, waitMinutes: 55, note: '', createdAt: Date.now() - 3000 },
    { id: 'r4', userId: 'u2', date: localDateString(yesterday), start: '07:00', end: '16:40', breakMinutes: 60, waitMinutes: 80, note: '', createdAt: Date.now() - 86400000 }
  ]
};

export const NAV_ITEMS = [
  { id: 'analytics', label: '分析結果', icon: '◫' },
  { id: 'entry', label: 'データ入力', icon: '＋' },
  { id: 'records', label: '記録を確認', icon: '▤' },
  { id: 'admin', label: 'ユーザー管理', icon: '♙' }
];

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.users) && Array.isArray(saved.records)) {
      saved.activeShifts = Array.isArray(saved.activeShifts) ? saved.activeShifts : [];
      saved.auditLog = Array.isArray(saved.auditLog) ? saved.auditLog : [];
      return saved;
    }
  } catch (error) {
    console.warn('保存データを読み込めませんでした。', error);
  }
  return structuredClone(sampleData);
}

export function persist(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function minutesBetween(start, end) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let difference = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (difference < 0) difference += 24 * 60;
  return difference;
}

export function recordStats(record) {
  const span = minutesBetween(record.start, record.end);
  const work = Math.max(0, span - Number(record.breakMinutes || 0));
  const wait = Number(record.waitMinutes || 0);
  const active = Math.max(0, work - wait);
  return { span, work, wait, active, rate: work ? active / work : 0 };
}

export function formatHours(minutes) {
  return (minutes / 60).toFixed(1);
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${date}T00:00:00`));
}

export function userById(state, id) {
  return state.users.find((user) => user.id === id);
}

export function recordsForToday(state, today) {
  return state.records.filter((record) => record.date === today);
}

export function totals(records) {
  return records.reduce((result, record) => {
    const stats = recordStats(record);
    result.work += stats.work;
    result.wait += stats.wait;
    result.active += stats.active;
    result.people.add(record.userId);
    return result;
  }, { work: 0, wait: 0, active: 0, people: new Set() });
}

export function logRecordChange(state, record, actor, action, { before = null, details = '', deleted = false } = {}) {
  state.auditLog ||= [];
  const snapshot = (item) => item && ({
    date: item.date,
    userId: item.userId,
    start: item.start,
    end: item.end,
    breakMinutes: Number(item.breakMinutes || 0),
    waitMinutes: Number(item.waitMinutes || 0),
    note: item.note || '',
    status: item.status || 'pending',
    reviewNote: item.reviewNote || ''
  });
  state.auditLog.unshift({
    id: crypto.randomUUID(),
    recordId: record.id,
    recordUserId: record.userId,
    recordUserName: userById(state, record.userId)?.name || '削除済みユーザー',
    actorId: actor.id,
    actorName: actor.name,
    action,
    details,
    before: snapshot(before),
    after: deleted ? null : snapshot(record),
    createdAt: new Date().toISOString()
  });
}

export function showToast(message) {
  const toast = document.querySelector('.toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}