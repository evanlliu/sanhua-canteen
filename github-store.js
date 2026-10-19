/**
 * GitHub Pages direct-mode data layer.
 * Token is AES-GCM obfuscated like midautumn-reservation.
 * IMPORTANT: browser-side decryption key is PUBLIC; this is NOT real secrecy.
 * Use disposable test credentials and fictitious employee data ONLY.
 */
import { decryptGitHubToken } from './token-obfuscation.js';
import { normalMeal, mealName } from './meal-schema.js';
const defaultMeals = [
  { id: 'breakfast', label: '早餐', start: '07:00', end: '09:00', enabled: false },
  { id: 'lunch', label: '午餐', start: '11:30', end: '14:00', enabled: true },
  { id: 'dinner', label: '晚餐', start: '17:30', end: '20:00', enabled: true },
];
const defaultSettings = { timeZone: 'America/Monterrey', maxAdvanceDays: 7, meals: defaultMeals };
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
function fail(text, status) { const err = new Error(text); if (status) err.status = status; throw err; }
function config() {
  const cfg = window.APP_CONFIG?.github || window.CANTEEN_CONFIG?.github || {};
  for (const field of ['owner', 'repo', 'branch', 'path']) {
    const value = String(cfg[field] ?? '').trim();
    if (!value || /^(YOUR_|REPLACE_|PASTE_)/i.test(value)) fail(`尚未配置 GitHub ${field}，请修改 config.js 或使用 ?demo=1 体验。`);
  }
  return cfg;
}
let tokenCacheKey = '', tokenCachePromise = null;
async function tokenFor(path, method) {
  const cfg = config();
  const isAdmin = path.startsWith('/api/admin/');
  // 后台的密码只用于前端界面登录。GitHub API 写入 Token 仍从
  // config.js 的混淆配置读取，不要求管理员再手动输入 PAT。
  // GitHub Pages 无服务端认证，这不是实质性的访问控制。
  if (!isAdmin && method === 'GET') return '';
  const ciphertext = String(cfg.tokenCiphertext || '').trim();
  const material = String(cfg.keyMaterial || '').trim();
  if (!ciphertext || !material) fail('尚未配置加密的 GitHub 写入 Token，请使用 token-tool.html 生成后填写 config.js，或使用 ?demo=1 演示。');
  const cacheKey = JSON.stringify([ciphertext, material]);
  if (cacheKey !== tokenCacheKey || !tokenCachePromise) {
    tokenCacheKey = cacheKey;
    tokenCachePromise = decryptGitHubToken(ciphertext, material);
  }
  return tokenCachePromise;
}
function ghUrl(cfg) {
  const location = String(cfg.path).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${location}`;
}
function headers(token) { return {
  Accept: 'application/vnd.github+json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  'X-GitHub-Api-Version': '2022-11-28',
}; }
function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function b64ToText(value) {
  const bytes = Uint8Array.from(atob(String(value).replace(/\s/g, '')), char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function ghFetch(url, options = {}) {
  let response;
  try { response = await fetch(url, { cache: 'no-store', ...options }); }
  catch { fail('无法访问 GitHub API，请检查网络或浏览器连接。'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = response.status;
    const err = new Error(status === 401 ? 'GitHub Token 无效或已失效' :
      status === 403 ? 'GitHub 禁止访问：检查 Token 权限、访问限制或 API 频率限制' :
      status === 404 ? '未找到 GitHub 仓库的 data 分支或 data.json，请检查仓库、分支和权限' :
      status === 409 ? '其他用户正在操作，请稍后重试' :
      status === 422 ? 'GitHub 数据已变化或请求无效，请刷新重试' :
      `GitHub 请求失败（HTTP ${status}）`);
    err.status = status;
    err.conflict = status === 409 || (status === 422 && /sha|fast.forward|does not match/i.test(String(data.message || '')));
    throw err;
  }
  return data;
}
async function read(token) {
  const cfg = config();
  const url = new URL(ghUrl(cfg));
  url.searchParams.set('ref', cfg.branch);
  // Explicit cache busting for fresh reservation counts during shared writes.
  url.searchParams.set('_', String(Date.now()));
  const result = await ghFetch(url.toString(), { headers: headers(token) });
  if (!result.sha || result.type !== 'file' || typeof result.content !== 'string') fail('data.json 过大或 GitHub 返回的数据不是普通文件');
  let data;
  try { data = JSON.parse(b64ToText(result.content)); }
  catch { fail('GitHub data.json 内容不是有效 JSON，请检查文件'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('data.json 的根节点必须为对象');
  data.settings = { ...defaultSettings, ...data.settings, maxAdvanceDays: 0, meals: (Array.isArray(data.settings?.meals) ? data.settings.meals : defaultMeals).map(normalMeal) };
  data.employees = Array.isArray(data.employees) ? data.employees : [];
  data.reservations = Array.isArray(data.reservations) ? data.reservations : [];
  return { data, sha: result.sha };
}
async function write(token, data, sha, description) {
  const cfg = config();
  const payload = JSON.stringify(data, null, 2) + '\n';
  if (new TextEncoder().encode(payload).length > 900000) fail('预约数据已超过 900KB，请备份归档后继续使用');
  return ghFetch(ghUrl(cfg), {
    method: 'PUT', headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `canteen: ${description}`, content: textToB64(payload), sha, branch: cfg.branch }),
  });
}
async function mutate(token, reason, updater) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, sha } = await read(token);
    const output = updater(data);
    data.updatedAt = new Date().toISOString();
    try { await write(token, data, sha, reason); return output; }
    catch (err) {
      if (err.conflict && attempt < 4) { await wait(120 * (attempt + 1)); continue; }
      throw err;
    }
  }
  fail('写入繁忙，请稍后重试');
}
function clock(timeZone) {
  let parts;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    parts = Object.fromEntries(fmt.formatToParts(new Date()).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  } catch { fail('配置中的时区无效，请管理员检查后台设置'); }
  return { today: `${parts.year}-${parts.month}-${parts.day}`, nowTime: `${parts.hour}:${parts.minute}` };
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const date = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}
function daysBetween(date, today) {
  return (Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000;
}
function cleanSettings(obj) {
  if (!obj || typeof obj !== 'object') fail('提交的设置无效');
  const timeZone = String(obj.timeZone || '').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); }
  catch { fail('请输入有效时区，例如 America/Monterrey'); }
  if (!Array.isArray(obj.meals) || obj.meals.length < 1 || obj.meals.length > 12) fail('请配置 1～12 个餐次');
  const ids = new Set();
  const meals = obj.meals.map((m, i) => {
    const id = String(m?.id || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || ids.has(id)) fail(`第 ${i + 1} 个餐次 ID 无效或重复`);
    ids.add(id);
    const nameZh = String(m?.nameZh || m?.label || '').trim();
    const nameEn = String(m?.nameEn || nameZh).trim();
    const nameEs = String(m?.nameEs || nameZh).trim();
    if (!nameZh || [nameZh,nameEn,nameEs].some(n => n.length > 40)) fail(`第 ${i + 1} 个餐次名称不能为空或超过 40 字`);
    const start = String(m?.start || ''), end = String(m?.end || '');
    const validTime = x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x);
    if (!validTime(start) || !validTime(end) || start >= end) fail(`餐次「${nameZh}」的结束时间必须晚于开始时间`);
    if (typeof m.enabled !== 'boolean') fail(`餐次「${nameZh}」的启用状态无效`);
    return { id, label: nameZh, nameZh, nameEn, nameEs, start, end, enabled: m.enabled };
  });
  return { timeZone, maxAdvanceDays: 0, meals };
}
function cleanEmployees(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 15000) fail('花名册必须有 1～15000 位员工');
  const seen = new Set();
  return rows.map((row, i) => {
    const employeeId = String(row?.employeeId || '').trim();
    const name = String(row?.name || '').trim();
    if (!/^\d{1,24}$/.test(employeeId)) fail(`第 ${i + 1} 行员工工号无效`);
    if (!name || name.length > 80) fail(`第 ${i + 1} 行员工姓名无效`);
    if (seen.has(employeeId)) fail('Excel 中存在重复工号：' + employeeId);
    seen.add(employeeId);
    return { employeeId, name };
  });
}
function newCode() { return 'C' + Array.from(crypto.getRandomValues(new Uint8Array(5)), n => n.toString(16).padStart(2, '0')).join('').toUpperCase(); }
const byDate = rows => [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
export async function githubApi(path, { method = 'GET', body = null, adminKey = '' } = {}) {
  const url = new URL(path, 'https://canteen.invalid');
  const p = url.pathname, token = await tokenFor(p, method);
  if (p === '/api/config' && method === 'GET') {
    const { data } = await read(token);
    return { settings: data.settings, ...clock(data.settings.timeZone) };
  }
  if (p === '/api/employees/search' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!/^\d{1,24}$/.test(q)) return { employees: [] };
    const { data } = await read(token);
    // Prioritize exact matches, then prefix matches, so a one-digit ID
    // remains visible even when the roster contains thousands of employees.
    const rank = id => id === q ? 0 : id.startsWith(q) ? 1 : 2;
    return { employees: data.employees
      .filter(e => String(e.employeeId).includes(q))
      .sort((a, b) => {
        const left = String(a.employeeId), right = String(b.employeeId);
        return rank(left) - rank(right) || left.length - right.length || left.localeCompare(right, 'en', { numeric: true });
      })
      .slice(0, 12) };
  }
  if (p === '/api/reservations/my' && method === 'GET') {
    const id = (url.searchParams.get('employeeId') || '').trim();
    if (!/^\d{1,24}$/.test(id)) fail('请输入完整的数字工号');
    const { data } = await read(token);
    return { reservations: byDate(data.reservations.filter(r => String(r.employeeId) === id)) };
  }
  if (p === '/api/reservations' && method === 'POST') {
    const employeeId = String(body?.employeeId || '').trim();
    const date = String(body?.date || ''), mealId = String(body?.mealId || '');
    if (!/^\d{1,24}$/.test(employeeId) || !validDate(date) || !/^[a-z][a-z0-9_-]{0,39}$/.test(mealId)) fail('员工、用餐日期或餐次无效');
    return mutate(token, `reserve ${mealId} ${date}`, data => {
      const e = data.employees.find(e => String(e.employeeId) === employeeId);
      if (!e) fail('工号不在花名册中');
      const { today, nowTime } = clock(data.settings.timeZone);
      if (date !== today) fail('仅允许预约当天用餐，请刷新页面后重试');
      const meal = data.settings.meals.find(m => m.id === mealId);
      if (!meal?.enabled) fail('此餐次暂未开放预约');
      if (nowTime >= meal.end) fail('今天该餐次已结束');
      if (data.reservations.some(r => String(r.employeeId) === employeeId && r.date === date && r.mealId === mealId)) fail('此员工当天该餐次已预约，不能重复预约', 409);
      if (data.reservations.some(r => String(r.employeeId) === employeeId && r.date === date && r.mealStart < meal.end && meal.start < r.mealEnd)) fail('该员工在重叠的用餐时段已预约，不能重复预约', 409);
      let id = newCode(); while (data.reservations.some(r => r.id === id)) id = newCode();
      const reservation = { id, employeeId, employeeName: e.name, mealId, date,
        mealStart: meal.start, mealEnd: meal.end, mealNameZh: mealName(meal, 'zh'), mealNameEn: mealName(meal, 'en'), mealNameEs: mealName(meal, 'es'), createdAt: new Date().toISOString() };
      data.reservations.push(reservation);
      return { reservation };
    });
  }
  if (!p.startsWith('/api/admin/')) fail('接口不存在', 404);
  if (p === '/api/admin/dashboard' && method === 'GET') {
    const { data } = await read(token);
    return { ...data, reservations: byDate(data.reservations), ...clock(data.settings.timeZone) };
  }
  if (p === '/api/admin/import-roster' && method === 'POST') {
    if (!['merge', 'replace'].includes(body?.mode)) fail('导入方式无效');
    const employees = cleanEmployees(body.employees);
    return mutate(token, `roster ${body.mode}`, data => {
      const oldCount = data.employees.length;
      if (body.mode === 'replace') data.employees = employees;
      else {
        const merged = new Map(data.employees.map(e => [e.employeeId, e]));
        for (const e of employees) merged.set(e.employeeId, e);
        data.employees = [...merged.values()];
      }
      return { oldCount, imported: employees.length, total: data.employees.length };
    });
  }
  if (p === '/api/admin/settings' && method === 'PUT') {
    const settings = cleanSettings(body);
    return mutate(token, 'meal settings', data => { data.settings = settings; return { settings }; });
  }
  if (p.startsWith('/api/admin/reservations/') && method === 'DELETE') {
    const id = decodeURIComponent(p.split('/').pop()).trim().toUpperCase();
    if (!/^C[A-F0-9]{10}$/.test(id)) fail('预约编号无效');
    return mutate(token, `delete ${id}`, data => {
      const index = data.reservations.findIndex(r => r.id === id);
      if (index < 0) fail('该预约已不存在', 404);
      const [removed] = data.reservations.splice(index, 1);
      return { removed };
    });
  }
  fail('后台接口不存在', 404);
}
