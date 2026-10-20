import { githubApi } from './github-store.js';
import { normalMeal, canBookMeal } from './meal-schema.js';
import { searchEmployees } from './employee-search.js';
import { validPlant, nextReservationCode } from './plant-schema.js';
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const KEY = 'evan-canteen-local-demo-v1';
const initialState = {
  settings: {
    timeZone: 'America/Monterrey', maxAdvanceDays: 7,
    meals: [
      { id: 'breakfast', label: '早餐', start: '07:00', end: '09:00', enabled: false },
      { id: 'lunch', label: '午餐', start: '11:30', end: '14:00', enabled: true },
      { id: 'dinner', label: '晚餐', start: '17:30', end: '20:00', enabled: true },
    ],
  },
  rosterColumns: ['ID', 'Name'], employees: [{ employeeId: '1000000001', name: '测试员工', values: ['1000000001','测试员工'] }], reservations: [],
};
export const isDemo = DEMO;
export function html(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
export function mealTitle(id) { return ({ breakfast: '早餐', lunch: '午餐', dinner: '晚餐' })[id] || id; }
export function dateOffset(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function localClock(tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { today: `${p.year}-${p.month}-${p.day}`, nowTime: `${p.hour}:${p.minute}` };
}
export function formatTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function demoLoad() {
  try { const found = JSON.parse(localStorage.getItem(KEY)); return found && Array.isArray(found.employees) ? found : structuredClone(initialState); }
  catch { return structuredClone(initialState); }
}
function demoSave(data) { localStorage.setItem(KEY, JSON.stringify(data)); }
function bad(s) { throw new Error(s); }
function demoApi(path, { method = 'GET', body = null, adminKey = '' } = {}) {
  const db = demoLoad();
  const url = new URL(path, location.origin === 'null' ? 'https://demo.local' : location.origin);
  const p = url.pathname;
  if (p.startsWith('/api/admin/') && adminKey !== 'demo') bad('演示模式请使用“体验管理后台”按钮');
  if (p === '/api/config') return { settings: { ...db.settings, maxAdvanceDays: 0, meals: db.settings.meals.map(normalMeal) }, ...localClock(db.settings.timeZone) };
  if (p === '/api/employees/search') {
    return { employees: searchEmployees(db.employees, url.searchParams.get('q') || '').map(({ employeeId, name }) => ({ employeeId, name })) };
  }
  if (p === '/api/reservations/my') return { reservations: db.reservations.filter(x => x.employeeId === url.searchParams.get('employeeId')).sort((a, b) => b.date.localeCompare(a.date)) };
  if (p === '/api/reservations' && method === 'POST') {
    const { employeeId, date, mealId, plant } = body;
    if (!validPlant(plant)) bad('请选择 Plant D / G / B / H');
    const e = db.employees.find(x => x.employeeId === employeeId);
    if (!e) bad('工号不在花名册中');
    const m = db.settings.meals.find(x => x.id === mealId);
    if (!m?.enabled) bad('此餐次尚未开放');
    const { today, nowTime } = localClock(db.settings.timeZone);
    if (date !== today) bad('仅允许预约当天用餐，请刷新页面后重试');
    if (nowTime < m.start) bad('尚未到该餐次的预约时间');
    if (nowTime >= m.end) bad('该餐次今日已结束');
    if (!canBookMeal(m, today, date, nowTime)) bad('当前不在该餐次的预约时段');
    if (db.reservations.some(x => x.employeeId === employeeId && x.date === date && x.mealId === mealId)) bad('此员工已预约当天该餐次，每餐只能预约一次');
    if (db.reservations.some(x => x.employeeId === employeeId && x.date === date && x.mealStart < m.end && m.start < x.mealEnd)) bad('该员工在重叠的用餐时段已预约，不能重复预约');
    const id = nextReservationCode(db, date, plant);
    const reservation = { id, employeeId, employeeName: e.name, plant, mealId, date, mealStart: m.start, mealEnd: m.end, mealNameZh: normalMeal(m).nameZh, mealNameEn: normalMeal(m).nameEn, mealNameEs: normalMeal(m).nameEs, createdAt: new Date().toISOString() };
    db.reservations.push(reservation); demoSave(db); return { reservation };
  }
  if (p === '/api/admin/dashboard') return { ...db, settings: {...db.settings, maxAdvanceDays: 0, meals: db.settings.meals.map(normalMeal)}, ...localClock(db.settings.timeZone) };
  if (p === '/api/admin/import-roster' && method === 'POST') {
    const oldCount = db.employees.length;
    if (body.mode === 'replace') { db.employees = body.employees; db.rosterColumns = body.columns || []; }
    else {
      if (db.rosterColumns?.length && JSON.stringify(db.rosterColumns) !== JSON.stringify(body.columns)) bad('花名册列名已变化，请选择全量覆盖');
      db.rosterColumns = body.columns || [];
      const map = new Map(db.employees.map(e => [e.employeeId, e]));
      for (const e of body.employees) map.set(e.employeeId, e);
      db.employees = [...map.values()];
    }
    demoSave(db); return { oldCount, imported: body.employees.length, total: db.employees.length };
  }
  if (p === '/api/admin/settings' && method === 'PUT') { if (!Array.isArray(body?.meals) || !body.meals.length) bad('至少保留一个餐次'); db.settings = {...body, maxAdvanceDays: 0, meals: body.meals.map(normalMeal)}; demoSave(db); return { settings: db.settings }; }
  if (p.startsWith('/api/admin/reservations/') && method === 'DELETE') {
    const id = p.split('/').pop(), index = db.reservations.findIndex(r => r.id === id);
    if (index < 0) bad('记录不存在');
    const [removed] = db.reservations.splice(index, 1);
    demoSave(db); return { removed };
  }
  bad('演示接口不存在');
}
export async function api(path, { method = 'GET', body, adminKey } = {}) {
  if (DEMO) return demoApi(path, { method, body, adminKey });
  return githubApi(path, { method, body, adminKey });
}
