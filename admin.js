import { api, isDemo, html, mealTitle, formatTime } from './client-api.js';
import { readXlsxRows } from './xlsx-reader.js';
import { normalMeal, mealName, mealIcon, reservationMeal } from './meal-schema.js';
import { newTicketIdentity, transferLink, resetDeviceLink } from './ticket-storage.js';
const $ = id => document.getElementById(id);
let adminKey = '', db = null, rosterFileRows = null, rosterFileColumns = null, busy = false;
let filtered = [];
// This cookie is only a temporary client-side login convenience; it is NOT server-side authorization.
const ADMIN_COOKIE = 'sanhua_canteen_admin_v7';
const LOGIN_TTL_MS = 5 * 60 * 60 * 1000;
let sessionExpiresAt = 0;
let sessionTimer = null;
function cookieOptions() {
  // Scope cookie to this GitHub Pages project instead of other repositories on the same domain.
  let path = '/';
  try { path = new URL('./', location.href).pathname; } catch { /* local about:blank demo */ }
  return `Path=${path}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}
function readLoginCookie() {
  const pair = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(ADMIN_COOKIE + '='));
  if (!pair) return '';
  try { return decodeURIComponent(pair.slice(ADMIN_COOKIE.length + 1)); } catch { return ''; }
}
function clearLoginCookie() {
  document.cookie = `${ADMIN_COOKIE}=; ${cookieOptions()}; Max-Age=0`;
}
async function passwordFingerprint() {
  const password = String(window.APP_CONFIG?.github?.adminPassword ?? '').trim();
  if (!password) return '';
  // Fingerprint, not a secret signature: public config.js means this can be forged.
  const bytes = new TextEncoder().encode(`sanhua-canteen:${location.origin}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}
async function storedSessionExpiry() {
  const raw = readLoginCookie();
  if (!raw) return 0;
  const [signature, timestamp] = raw.split('.');
  const expiresAt = Number(timestamp);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || signature !== await passwordFingerprint()) {
    clearLoginCookie();
    return 0;
  }
  return expiresAt;
}
function activateSession(expiresAt) {
  sessionExpiresAt = expiresAt;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
      logout();
      message('loginStatus', '登录已过期，请重新输入密码。', true);
    }
  }, Math.max(0, expiresAt - Date.now()));
}
async function rememberLogin() {
  const fingerprint = await passwordFingerprint();
  if (!fingerprint) return;
  const expiresAt = Date.now() + LOGIN_TTL_MS;
  document.cookie = `${ADMIN_COOKIE}=${encodeURIComponent(fingerprint + '.' + expiresAt)}; ${cookieOptions()}; Max-Age=${LOGIN_TTL_MS / 1000}`;
  activateSession(expiresAt);
}
function showDashboard() {
  $('adminPassword').value = '';
  $('loginArea').classList.add('hidden');
  document.body.classList.remove('admin-login-mode');
  $('dashboardArea').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  // 完成数据加载后再切到后台；恢复 Cookie 时完全不会闪现登录表单。
  document.documentElement.dataset.adminBoot = 'dashboard';
  message('loginStatus');
}

function message(id, text = '', error = false) { const e = $(id); e.textContent = text; e.classList.toggle('error', error); }
function adminAlert(text, error = false) { const e = $('adminAlert'); e.textContent = text; e.classList.remove('hidden'); e.classList.toggle('error', error); }
function authApi(path, opts = {}) {
  if (sessionExpiresAt && Date.now() >= sessionExpiresAt) {
    logout();
    return Promise.reject(new Error('登录已过期，请重新输入密码。'));
  }
  return api(path, { ...opts, adminKey });
}
function onError(error, target = 'adminAlert') {
  const text = error?.message || '操作失败';
  if (target === 'adminAlert') adminAlert(text, true); else message(target, text, true);
  if (error?.status === 401 && !isDemo) logout();
}
async function login(event) {
  event?.preventDefault();
  const password = $('adminPassword').value;
  const expected = String(window.APP_CONFIG?.github?.adminPassword ?? '').trim();
  if (!expected) return message('loginStatus', '请先在 config.js 设置 adminPassword', true);
  if (password !== expected) return message('loginStatus', '管理员密码错误，请重试', true);
  // 仅记录演示模式需要的本地 API 标记；不再要求管理员输入 GitHub PAT。
  adminKey = isDemo ? 'demo' : '';
  $('loginBtn').disabled = true; message('loginStatus', '正在连接预约数据…');
  try {
    await refresh();
    await rememberLogin();
    showDashboard();
  } catch (error) {
    adminKey = '';
    message('loginStatus', error.message || '登录失败', true);
  } finally { $('loginBtn').disabled = false; }
}
function logout() {
  adminKey = ''; db = null; sessionExpiresAt = 0;
  clearTimeout(sessionTimer); sessionTimer = null;
  clearLoginCookie();
  $('dashboardArea').classList.add('hidden');
  $('loginArea').classList.remove('hidden');
  document.body.classList.add('admin-login-mode');
  document.documentElement.dataset.adminBoot = 'login';
  window.scrollTo(0, 0);
  $('logoutBtn').classList.add('hidden');
  $('adminPassword').value = '';
  $('adminPassword').focus({ preventScroll: true });
}

async function refresh() {
  $('refreshBtn').disabled = true;
  try {
    db = await authApi('/api/admin/dashboard');
    $('adminAlert').classList.add('hidden');
    renderAll();
    $('updateLabel').textContent = '刷新于 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } finally { $('refreshBtn').disabled = false; }
}
function renderAll() {
  if (!db) return;
  $('statEmployee').textContent = db.employees.length;
  $('statTotal').textContent = db.reservations.length;
  $('statToday').textContent = db.reservations.filter(x => x.date === db.today).length;
  $('statEnabled').textContent = db.settings.meals.filter(x => x.enabled).length;
  $('todayLabel').textContent = `用餐日期：${db.today}`;
  renderMealFilters(); renderBookings(); renderRoster(); renderSettings(); renderETickets();
}
function displayMeal(row) { return reservationMeal(row, db?.settings?.meals || [], 'zh'); }
function renderMealFilters() {
  const select = $('fMeal'), previous = select.value;
  const pairs = new Map(db.settings.meals.map(m => [m.id, mealName(m, 'zh')]));
  for (const r of db.reservations) if (!pairs.has(r.mealId)) pairs.set(r.mealId, displayMeal(r) + '（历史）');
  select.replaceChildren();
  const all = document.createElement('option'); all.value=''; all.textContent='全部餐次'; select.append(all);
  for (const [id,name] of pairs) { const el = document.createElement('option'); el.value=id; el.textContent=name; select.append(el); }
  select.value = pairs.has(previous) ? previous : '';
}
function filteredRows() {
  const word = $('fKeyword').value.trim().toLowerCase(), id = $('fEmployeeId').value.trim(), date = $('fDate').value, meal = $('fMeal').value;
  return db.reservations.filter(r => {
    if (word && ![r.employeeName, r.employeeId, r.id].some(s => String(s ?? '').toLowerCase().includes(word))) return false;
    if (id && !String(r.employeeId).includes(id)) return false;
    if (date && r.date !== date) return false;
    if (meal && r.mealId !== meal) return false;
    return true;
  });
}
function renderBookings() {
  if (!db) return;
  filtered = filteredRows(); $('filteredCount').textContent = `符合条件 ${filtered.length} 条 / 共 ${db.reservations.length} 条`;
  const tbody = $('reservationTbody'), mobile = $('reservationMobile');
  tbody.replaceChildren(); mobile.replaceChildren();
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="admin-empty">暂无符合条件的预约记录</td></tr>';
    mobile.innerHTML = '<div class="admin-empty">暂无符合条件的预约记录</div>'; return;
  }
  for (const row of filtered) {
    const tr = document.createElement('tr');
    for (const [val, klass] of [[row.id, 'id-cell'], [row.employeeId, ''], [row.employeeName, ''], [displayMeal(row), ''], [row.plant ? `Plant ${row.plant}` : '—', ''], [row.date, ''], [`${row.mealStart} – ${row.mealEnd}`, ''], [formatTime(row.createdAt), '']]) {
      const td = document.createElement('td'); td.textContent = val ?? ''; if (klass) td.className = klass; tr.append(td);
    }
    const action = document.createElement('td'), del = document.createElement('button');
    del.className = 'action danger small'; del.textContent = '删除'; del.disabled = busy;
    del.addEventListener('click', () => removeBooking(row)); action.append(del); tr.append(action); tbody.append(tr);
    const card = document.createElement('article'); card.className = 'admin-entry';
    card.innerHTML = `<div class="item-head"><strong>${html(row.employeeName)} · ${html(displayMeal(row))}</strong><span class="id-cell">${html(row.id)}</span></div><div class="item-meta">工号 ${html(row.employeeId)}<br>${row.plant ? html('Plant ' + row.plant) + '<br>' : ''}用餐 ${html(row.date)} · ${html(row.mealStart)}–${html(row.mealEnd)}<br>提交于 ${html(formatTime(row.createdAt))}</div>`;
    const d = del.cloneNode(true); d.addEventListener('click', () => removeBooking(row)); card.append(d); mobile.append(card);
  }
}
async function removeBooking(row) {
  if (busy) return;
  if (!confirm(`确认删除预约吗？\n\n${row.employeeName}（${row.employeeId}）\n${row.date} · ${displayMeal(row)}\n预约编号：${row.id}\n\n删除后该员工可重新预约此餐次。`)) return;
  busy = true; renderBookings();
  try { await authApi('/api/admin/reservations/' + encodeURIComponent(row.id), { method: 'DELETE' }); await refresh(); adminAlert('已删除预约 ' + row.id + '，该餐次现在可以重新预约。'); }
  catch (error) { onError(error); }
  finally { busy = false; renderBookings(); }
}
function renderRoster() {
  if (!db) return;
  const term = $('rosterFilter').value.trim().toLowerCase();
  const subset = db.employees.filter(e => e.employeeId.includes(term) || e.name.toLowerCase().includes(term));
  $('rosterCount').textContent = `当前 ${db.employees.length} 位员工，匹配 ${subset.length} 位`;
  const tbody = $('rosterTbody'); tbody.replaceChildren();
  if (!subset.length) { tbody.innerHTML = '<tr><td colspan="3" class="admin-empty">没有匹配的员工</td></tr>'; }
  for (const e of subset.slice(0, 100)) {
    const tr = document.createElement('tr');
    for (const val of [e.employeeId, e.name]) { const td = document.createElement('td'); td.textContent = val; tr.append(td); }
    const td = document.createElement('td'), detail = document.createElement('button'); detail.type='button'; detail.className='action secondary small'; detail.textContent='查看'; detail.onclick=()=>showRosterDetails(e); td.append(detail); tr.append(td);
    tbody.append(tr);
  }
  $('rosterNote').textContent = subset.length > 100 ? '为保证页面流畅，仅显示前 100 条，请使用搜索框缩小范围。' : '';
}
function rosterValues(employee, columns) {
  if (Array.isArray(employee.values) && employee.values.length === columns.length) return employee.values;
  return columns.map(column => /^(id|员工工号|工号)$/i.test(column.trim()) ? employee.employeeId : /^(name|员工姓名|姓名)$/i.test(column.trim()) ? employee.name : '');
}
function showRosterDetails(employee) {
  const columns = db.rosterColumns?.length ? db.rosterColumns : ['工号','姓名'];
  const values = rosterValues(employee, columns);
  $('rosterDetailTitle').textContent = `${employee.name}（${employee.employeeId}）`;
  const container = $('rosterDetailRows'); container.replaceChildren();
  columns.forEach((column, i) => { const row=document.createElement('div'); row.className='roster-detail-row';
    const title=document.createElement('strong'); title.textContent=column;
    const value=document.createElement('span'); value.textContent=String(values[i]??'');
    row.append(title,value); container.append(row); });
  $('rosterDetailDialog').showModal();
}
function exportRosterCSV() {
  if (!db) return;
  const columns = db.rosterColumns?.length ? db.rosterColumns : ['工号','姓名'];
  const rows = [columns, ...db.employees.map(e => rosterValues(e,columns))];
  const csv='\uFEFF'+rows.map(r=>r.map(csvSafe).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a'); link.href=url; link.download=`员工花名册_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function collectMealCards() {
  return [...document.querySelectorAll('#configCards [data-id]')].map(el => ({
    id: el.dataset.id,
    nameZh: el.querySelector('.name-zh').value.trim(),
    nameEn: el.querySelector('.name-en').value.trim(),
    nameEs: el.querySelector('.name-es').value.trim(),
    start: el.querySelector('.meal-start').value,
    end: el.querySelector('.meal-end').value,
    enabled: el.querySelector('.meal-enabled').checked,
  }));
}
function displayMealCards(meals) {
  $('configCards').innerHTML = meals.map((raw,index) => {
    const m = normalMeal(raw);
    return `<article class="config-card" data-id="${html(m.id)}">
      <div class="meal-card-header"><h3>${mealIcon(m.id)} <span>${html(m.nameZh)}</span></h3><div class="btn-row">
      <button type="button" class="action secondary small move-up" title="上移" ${index===0?'disabled':''}>↑</button>
      <button type="button" class="action secondary small move-down" title="下移" ${index===meals.length-1?'disabled':''}>↓</button>
      <button type="button" class="action danger small remove-meal" title="删除餐次">删除</button></div></div>
      <div class="meal-name-fields">
        <label><span class="label">中文名称</span><input class="control name-zh" maxlength="40" value="${html(m.nameZh)}" placeholder="例如：夜宵"></label>
        <label><span class="label">English name</span><input class="control name-en" maxlength="40" value="${html(m.nameEn)}" placeholder="e.g. Late-night meal"></label>
        <label><span class="label">Nombre en español (México)</span><input class="control name-es" maxlength="40" value="${html(m.nameEs)}" placeholder="Ej. Cena nocturna"></label>
      </div>
      <div class="times"><label><span class="label">开始时间</span><input class="control meal-start" type="time" value="${html(m.start)}" required></label><label><span class="label">结束时间</span><input class="control meal-end" type="time" value="${html(m.end)}" required></label></div>
      <label class="toggle-line"><input type="checkbox" class="meal-enabled" ${m.enabled ? 'checked' : ''}> 对员工开放此餐次</label>
    </article>`;
  }).join('');
  $('configCards').querySelectorAll('.config-card').forEach((el,index) => {
    el.querySelector('.remove-meal').addEventListener('click', () => {
      const draft = collectMealCards();
      if (draft.length === 1) { message('settingsStatus','必须至少保留一个餐次', true); return; }
      if (!confirm(`确定删除「${draft[index].nameZh || draft[index].id}」吗？保存设置后员工端将不再显示，历史预约仍保留。`)) return;
      draft.splice(index,1); displayMealCards(draft);
    });
    el.querySelector('.move-up').addEventListener('click', () => {
      if(index === 0) return; const draft=collectMealCards(); [draft[index-1], draft[index]]=[draft[index],draft[index-1]]; displayMealCards(draft);
    });
    el.querySelector('.move-down').addEventListener('click', () => {
      const draft=collectMealCards(); if(index === draft.length-1) return;
      [draft[index+1], draft[index]]=[draft[index],draft[index+1]]; displayMealCards(draft);
    });
    el.querySelector('.name-zh').addEventListener('input', ev => { el.querySelector('h3 span').textContent = ev.target.value || '未命名'; });
  });
}

// V11: timezone must be selected from a predefined list (no manual text input).
// Common choices are prioritized. The full IANA list is included when supported
// by the browser so existing valid configurations are never silently lost.
const COMMON_TIME_ZONES = [
  ['墨西哥常用时区', [
    ['America/Monterrey', '蒙特雷 / Monterrey'],
    ['America/Mexico_City', '墨西哥城 / Ciudad de México'],
    ['America/Matamoros', '马塔莫罗斯 / Matamoros'],
    ['America/Chihuahua', '奇瓦瓦 / Chihuahua'],
    ['America/Ojinaga', '奥希纳加 / Ojinaga'],
    ['America/Mazatlan', '马萨特兰 / Mazatlán'],
    ['America/Hermosillo', '埃莫西约 / Hermosillo'],
    ['America/Tijuana', '蒂华纳 / Tijuana'],
    ['America/Cancun', '坎昆 / Cancún'],
    ['America/Merida', '梅里达 / Mérida'],
    ['America/Bahia_Banderas', '班德拉斯湾 / Bahía de Banderas'],
  ]],
  ['美洲其他常用时区', [
    ['America/Los_Angeles', '洛杉矶 / Los Angeles'],
    ['America/Denver', '丹佛 / Denver'],
    ['America/Phoenix', '凤凰城 / Phoenix'],
    ['America/Chicago', '芝加哥 / Chicago'],
    ['America/New_York', '纽约 / New York'],
    ['America/Bogota', '波哥大 / Bogotá'],
    ['America/Lima', '利马 / Lima'],
    ['America/Sao_Paulo', '圣保罗 / São Paulo'],
  ]],
  ['欧洲与非洲', [
    ['Europe/London', '伦敦 / London'],
    ['Europe/Madrid', '马德里 / Madrid'],
    ['Europe/Paris', '巴黎 / Paris'],
    ['Europe/Berlin', '柏林 / Berlin'],
    ['Africa/Cairo', '开罗 / Cairo'],
    ['Africa/Johannesburg', '约翰内斯堡 / Johannesburg'],
  ]],
  ['亚洲与大洋洲', [
    ['Asia/Shanghai', '上海 / 中国标准时间'],
    ['Asia/Hong_Kong', '香港 / Hong Kong'],
    ['Asia/Tokyo', '东京 / Tokyo'],
    ['Asia/Singapore', '新加坡 / Singapore'],
    ['Asia/Kolkata', '加尔各答 / Kolkata'],
    ['Australia/Sydney', '悉尼 / Sydney'],
    ['Pacific/Auckland', '奥克兰 / Auckland'],
    ['UTC', '协调世界时 / UTC'],
  ]],
];
function isSupportedZone(zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return true; }
  catch { return false; }
}
function timeZoneOffset(zone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value;
    return (part || 'GMT').replace(/^GMT/, 'UTC');
  } catch { return ''; }
}
function populateTimeZones(savedZone) {
  const select = $('timezoneInput');
  const desired = String(savedZone || 'America/Monterrey');
  const added = new Set();
  select.replaceChildren();
  const makeGroup = label => {
    const group = document.createElement('optgroup');
    group.label = label;
    select.append(group);
    return group;
  };
  const addZone = (group, zone, name = zone) => {
    if (added.has(zone) || !isSupportedZone(zone)) return;
    const option = document.createElement('option');
    option.value = zone;
    option.textContent = `${name} (${timeZoneOffset(zone)}) · ${zone}`;
    group.append(option);
    added.add(zone);
  };
  for (const [label, zones] of COMMON_TIME_ZONES) {
    const group = makeGroup(label);
    for (const [zone, name] of zones) addZone(group, zone, name);
    if (!group.children.length) group.remove();
  }
  // All available IANA zones remain selectable beyond the commonly used groups.
  const other = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone').filter(zone => !added.has(zone))
    : [];
  if (other.length) {
    const group = makeGroup('其他 IANA 时区（按字母排序）');
    for (const zone of other) addZone(group, zone);
  }
  // Preserve previously saved zones (including aliases not listed by supportedValuesOf).
  if (!added.has(desired)) {
    const group = document.createElement('optgroup');
    group.label = isSupportedZone(desired) ? '当前已保存的时区' : '当前已保存（浏览器不支持，请更换）';
    select.prepend(group);
    const option = document.createElement('option');
    option.value = desired;
    option.textContent = desired;
    group.append(option);
  }
  select.value = desired;
}

function renderSettings() {
  if (!db) return;
  populateTimeZones(db.settings.timeZone);
  displayMealCards(db.settings.meals);
}
function addMeal() {
  if(!db || busy) return;
  const draft = collectMealCards();
  if(draft.length >= 12) return message('settingsStatus','最多只能设置 12 个餐次',true);
  let id;
  do { id = 'meal_' + crypto.getRandomValues(new Uint32Array(1))[0].toString(36); }
  while (draft.some(m => m.id === id));
  draft.push({id,nameZh:'新餐次',nameEn:'New meal',nameEs:'Nueva comida',start:'20:00',end:'21:00',enabled:false});
  displayMealCards(draft);
  const newest = $('configCards').lastElementChild;
  newest.scrollIntoView({behavior:'smooth',block:'nearest'});
  const input = newest.querySelector('.name-zh'); input.focus(); input.select();
  message('settingsStatus','已添加餐次。填写名称与时间后，记得点击保存。');
}
async function saveSettings() {
  if (!db || busy) return;
  const meals = collectMealCards();
  for (const m of meals) {
    if (!m.nameZh || [m.nameZh, m.nameEn, m.nameEs].some(n => n.length > 40)) return message('settingsStatus','中文名称不能为空，三个语言的名称均不可超过 40 字',true);
    if (!/^\d{2}:\d{2}$/.test(m.start) || !/^\d{2}:\d{2}$/.test(m.end) || m.end <= m.start) return message('settingsStatus',`「${m.nameZh}」结束时间必须晚于开始时间`, true);
  }
  if (!meals.length) return message('settingsStatus','至少保留一个餐次', true);
  const settings = { timeZone: $('timezoneInput').value, maxAdvanceDays: 0, meals };
  try { new Intl.DateTimeFormat('en-US',{timeZone:settings.timeZone}).format(); }
  catch { return message('settingsStatus','请选择有效的 IANA 时区',true); }
  busy = true; $('saveSettingsBtn').disabled = true; message('settingsStatus', '正在保存…');
  try { await authApi('/api/admin/settings', { method: 'PUT', body: settings }); await refresh(); message('settingsStatus', '✓ 餐次设置已保存，员工端刷新后即可生效。'); }
  catch (error) { onError(error, 'settingsStatus'); }
  finally { busy = false; $('saveSettingsBtn').disabled = false; }
}
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quote = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quote = false;
      else cell += c;
    } else if (c === '"') quote = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { row.push(cell); if (row.some(x => String(x).trim() !== '')) rows.push(row); row = []; cell = ''; if (c === '\r' && text[i + 1] === '\n') i++; }
    else cell += c;
  }
  if (quote) throw new Error('CSV 引号未闭合，请检查文件');
  row.push(cell); if (row.some(x => String(x).trim() !== '')) rows.push(row);
  return rows;
}
function loadSheetJs(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = () => window.XLSX ? resolve() : reject(new Error('Excel 库初始化失败'));
    s.onerror = () => reject(new Error('下载 Excel 解析库失败'));
    document.head.append(s);
  });
}
async function ensureXlsx() {
  if (window.XLSX) return;
  try { await loadSheetJs('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'); }
  catch { await loadSheetJs('https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'); }
}
function parseEmployees(rows) {
  if (!rows.length) throw new Error('文件没有内容');
  const canonical = v => String(v ?? '').replace(/\uFEFF/g, '').trim().replace(/[\s_\-]/g, '').toLowerCase();
  const originalHeaders = rows[0].map(v => String(v ?? ''));
  const headers = originalHeaders.map(canonical);
  const idIndex = headers.findIndex(t => ['工号', '员工工号', 'employeeid', 'id', 'númerodeempleado', 'numeroempleado'].includes(t));
  const nameIndex = headers.findIndex(t => ['姓名', '员工姓名', 'name', 'nombre', 'employeename'].includes(t));
  if (idIndex < 0 || nameIndex < 0) throw new Error('第一行必须包含 ID/Name 或 工号/姓名 表头');
  if (new Set(originalHeaders).size !== originalHeaders.length || originalHeaders.some(x=>!x.trim())) throw new Error('花名册存在空列名或重复列名，请修复后导入');
  const seen = new Set(), employees = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const employeeId = String(row[idIndex] ?? '').trim(), name = String(row[nameIndex] ?? '').trim();
    if (!employeeId && !name) continue;
    if (!/^\d{1,24}$/.test(employeeId)) throw new Error(`Excel 第 ${i + 1} 行：工号必须为纯数字，无法使用科学计数法`);
    if (!name || name.length > 80) throw new Error(`Excel 第 ${i + 1} 行：姓名为空或超过 80 字`);
    if (seen.has(employeeId)) throw new Error(`Excel 第 ${i + 1} 行：工号 ${employeeId} 在文件中重复`);
    const values = originalHeaders.map((header,j) => {
      const value = String(row[j] ?? '');
      // The lightweight XLSX reader retains numeric Excel serials. Display
      // Hiring Date as an ISO calendar date instead of an opaque five-digit code.
      if (/^hiring\s*date$/i.test(header.trim()) && /^\d{4,5}$/.test(value)) {
        const date = new Date(Date.UTC(1899,11,30) + Number(value)*86400000);
        if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0,10);
      }
      return value;
    });
    seen.add(employeeId); employees.push({ employeeId, name, values });
  }
  if (!employees.length) throw new Error('没有有效的员工资料');
  if (employees.length > 15000) throw new Error('一次最多导入 15000 名员工');
  return { employees, columns: originalHeaders };
}
async function readFile() {
  const file = $('rosterFile').files?.[0]; if (!file) return;
  rosterFileRows = null; rosterFileColumns = null; $('importBtn').disabled = true; $('filePreview').classList.add('hidden');
  $('fileInfo').textContent = `读取中：${file.name}`; message('importStatus');
  try {
    let rows;
    if (/\.csv$/i.test(file.name)) rows = parseCsv(await file.text());
    else if (/\.xlsx$/i.test(file.name)) rows = await readXlsxRows(file);
    else if (/\.xls$/i.test(file.name)) {
      await ensureXlsx();
      const book = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      if (!book.SheetNames?.length) throw new Error('Excel 没有工作表');
      rows = window.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: '' });
    } else throw new Error('请选择 .xlsx、.xls 或 .csv 格式文件');
    const parsed = parseEmployees(rows); rosterFileRows = parsed.employees; rosterFileColumns = parsed.columns;
    $('fileInfo').textContent = `✓ ${file.name} · 检查通过，共 ${rosterFileRows.length} 位员工`;
    $('filePreviewBody').innerHTML = rosterFileRows.slice(0, 5).map(e => `<tr><td>${html(e.employeeId)}</td><td>${html(e.name)}</td></tr>`).join('');
    $('filePreview').classList.remove('hidden'); $('importBtn').disabled = false;
  } catch (error) { $('fileInfo').textContent = '文件解析失败：' + error.message; message('importStatus', error.message, true); }
}
async function importRoster() {
  if (busy || !rosterFileRows?.length) return;
  const mode = document.querySelector('input[name="importMode"]:checked').value;
  if (mode === 'replace' && !confirm(`即将全量覆盖花名册！\n\n目前员工：${db.employees.length} 人\n新文件员工：${rosterFileRows.length} 人\n\n不在新文件的员工将无法继续预约，历史预约保留。确定继续？`)) return;
  if (mode === 'merge' && !confirm(`确认合并导入 ${rosterFileRows.length} 条员工记录吗？同工号员工的姓名会更新。`)) return;
  busy = true; $('importBtn').disabled = true; message('importStatus', '正在上传及更新花名册…');
  try {
    const result = await authApi('/api/admin/import-roster', { method: 'POST', body: { mode, columns: rosterFileColumns, employees: rosterFileRows } });
    await refresh(); message('importStatus', `✓ 导入成功：本次 ${result.imported} 人，花名册现有 ${result.total} 人。`);
  } catch (error) { onError(error, 'importStatus'); }
  finally { busy = false; $('importBtn').disabled = !rosterFileRows; }
}
function csvSafe(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function exportCSV() {
  if (!db) return;
  const data = [['预约号', '员工工号', '员工姓名', '餐次', 'Plant', '用餐日期', '开始时间', '结束时间', '预约提交时间'],
    ...filtered.map(r => [r.id, r.employeeId, r.employeeName, displayMeal(r), r.plant ? 'Plant '+r.plant : '', r.date, r.mealStart, r.mealEnd, formatTime(r.createdAt)])];
  const csv = '\uFEFF' + data.map(r => r.map(csvSafe).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `食堂预约记录_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function ticketStatus(row) {
  return row.redeemedAt||row.redeemStatus==='used'?'已使用':row.redeemStatus==='exception'?'异常待处理':row.credentialHash?'待领餐':'旧版餐票（未签发）';
}
function renderETickets() {
  if (!db) return;
  $('eTicketEnabled').checked=!!db.settings.eTicketEnabled;
  const rows=db.reservations;
  $('eTicketPending').textContent=rows.filter(x=>x.credentialHash&&!x.redeemedAt&&x.redeemStatus!=='used'&&x.redeemStatus!=='exception').length;
  $('eTicketUsed').textContent=rows.filter(x=>x.redeemedAt||x.redeemStatus==='used').length;
  $('eTicketException').textContent=rows.filter(x=>x.redeemStatus==='exception').length;
  renderTicketResults();
}
function renderTicketResults() {
  const container=$('ticketAdminResults');container.replaceChildren();
  if (!db) return;
  const q=$('ticketAdminSearch').value.trim().toLowerCase();
  const rows=db.reservations
    .filter(x=>{
      if (!q) return true;
      return [x.id, x.employeeId, x.employeeName, x.plant, x.date, displayMeal(x)].some(s => String(s ?? '').toLowerCase().includes(q));
    })
    .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  if (!rows.length) {container.textContent='未找到预约';return;}
  for (const r of rows) {
    const card=document.createElement('div');card.className='ticket-admin-entry';
    const detail=document.createElement('div');detail.className='ticket-admin-description';
    const bound=db.deviceBindings?.[String(r.employeeId)];
    const boundText=bound==='pending'?'待新设备激活':bound?'已绑定浏览器':'历史记录/未绑定';
    detail.textContent=`${r.id} · ${r.employeeName} (${r.employeeId}) · Plant ${r.plant||'?'} · ${displayMeal(r)} · ${ticketStatus(r)} · ${boundText}${r.redeemedAt?' · '+formatTime(r.redeemedAt):''}`;
    card.append(detail);
    const tools=document.createElement('div');tools.className='ticket-admin-actions';
    const reissue=document.createElement('button');reissue.type='button';reissue.className='action secondary small';reissue.textContent='换设备重新签发';
    reissue.disabled=busy||!!r.redeemedAt||r.redeemStatus==='used';reissue.onclick=()=>reissueTicket(r);
    const exception=document.createElement('button');exception.type='button';exception.className='action secondary small';exception.textContent='记录异常';
    exception.disabled=busy;exception.onclick=()=>recordTicketException(r);
    tools.append(reissue,exception);card.append(tools);container.append(card);
    if (r.ticketEvents?.length) {
      const notes=document.createElement('small');notes.className='muted';notes.textContent=`最近异常备注：${r.ticketEvents.at(-1).note}`;card.append(notes);
    }
  }
}
async function saveTicketMode() {
  if (busy) return;
  const enabled=$('eTicketEnabled').checked;
  if (!confirm(`确定${enabled?'开启':'关闭'}电子领餐模式吗？`)) {$('eTicketEnabled').checked=!!db.settings.eTicketEnabled;return;}
  busy=true;$('saveTicketMode').disabled=true;
  try {await authApi('/api/admin/tickets/toggle',{method:'PUT',body:{enabled}});await refresh();message('eTicketModeStatus',enabled?'电子领餐已启用':'电子领餐已关闭');}
  catch(e){onError(e,'eTicketModeStatus');$('eTicketEnabled').checked=!!db.settings.eTicketEnabled;}
  finally{busy=false;$('saveTicketMode').disabled=false;}
}
async function reissueTicket(row) {
  if (busy) return;
  if (!confirm(`请确认已经核实员工实体工牌。重新签发将使旧设备餐票失效：\n${row.id} · ${row.employeeName}`))return;
  busy=true;
  try {
    const identity=await newTicketIdentity();
    await authApi('/api/admin/tickets/reissue',{method:'POST',body:{id:row.id,credentialHash:identity.credentialHash}});
    const link=transferLink(row.id,identity.secret);
    $('ticketTransferLink').value=link;$('ticketTransferBox').classList.remove('hidden');
    await refresh();message('ticketAdminStatus',`已重新签发 ${row.id}。请当面将链接交付新设备；员工必须在新浏览器打开并激活。该员工其他未使用餐票需重新签发。`);
  } catch(e){onError(e,'ticketAdminStatus');}
  finally{busy=false;renderTicketResults();}
}
async function resetDeviceBinding() {
  if (busy) return;
  const employeeId=$('deviceResetEmployeeId').value.trim();
  if (!/^\d{1,24}$/.test(employeeId)) {message('deviceResetStatus','请输入完整的数字员工工号',true);return;}
  const employee=db?.employees?.find(e=>String(e.employeeId)===employeeId);
  if (!employee) {message('deviceResetStatus','工号不在花名册中',true);return;}
  if (!confirm(`请确认已核实员工工牌和换设备原因。\n\n${employee.name}（${employeeId}）\n\n重置绑定会暂停该员工所有未使用的旧餐票，必须重新签发才能在新设备使用。已使用记录不变。确定继续？`)) return;
  busy=true;$('deviceResetBtn').disabled=true;
  try {
    const identity=await newTicketIdentity();
    await authApi('/api/admin/devices/reset',{method:'POST',body:{employeeId,resetHash:identity.credentialHash}});
    $('ticketTransferLink').value=resetDeviceLink(employeeId,identity.secret);
    $('ticketTransferBox').classList.remove('hidden');
    await refresh();message('deviceResetStatus',`已重置 ${employee.name}（${employeeId}）的浏览器绑定。请当面交付下方一次性新设备激活链接；旧未使用餐票须重新签发。`);
  } catch(error) {onError(error,'deviceResetStatus');}
  finally {busy=false;$('deviceResetBtn').disabled=false;}
}
async function recordTicketException(row) {
  const note=prompt(`为 ${row.id} 记录异常原因（不会重置已使用状态）：`);
  if (note===null)return;
  if (note.trim().length<3) {message('ticketAdminStatus','请填写至少3个字符的原因',true);return;}
  busy=true;
  try {await authApi('/api/admin/tickets/exception',{method:'POST',body:{id:row.id,note:note.trim().slice(0,300)}});await refresh();message('ticketAdminStatus',`已记录 ${row.id} 的异常信息`);}
  catch(e){onError(e,'ticketAdminStatus');}
  finally{busy=false;renderTicketResults();}
}
function selectTab(tab) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(x => x.classList.toggle('active', x.id === 'tab-' + tab));
}
function init() {
  if (isDemo) { $('demoLoginBtn').classList.remove('hidden'); $('demoAdminHint').classList.remove('hidden'); }
  $('loginForm').addEventListener('submit', login);
  $('demoLoginBtn').onclick = () => { $('adminPassword').value = String(window.APP_CONFIG?.github?.adminPassword ?? ''); login(); };
  $('logoutBtn').onclick = logout;
  $('refreshBtn').onclick = () => refresh().catch(e => onError(e));
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => selectTab(btn.dataset.tab));
  for (const id of ['fKeyword', 'fDate', 'fEmployeeId', 'fMeal']) $(id).addEventListener('input', renderBookings);
  $('resetFilterBtn').onclick = () => { ['fKeyword', 'fDate', 'fEmployeeId', 'fMeal'].forEach(id => $(id).value = ''); renderBookings(); };
  $('exportBtn').onclick = exportCSV;
  $('rosterFilter').oninput = renderRoster;
  $('exportRosterBtn').onclick = exportRosterCSV;
  $('closeRosterDetail').onclick = () => $('rosterDetailDialog').close();
  $('rosterFile').onchange = readFile;
  $('importBtn').onclick = importRoster;
  $('saveSettingsBtn').onclick = saveSettings;
  $('addMealBtn').onclick = addMeal;
  $('saveTicketMode').onclick=saveTicketMode;
  $('ticketAdminFind').onclick=renderTicketResults;
  $('deviceResetBtn').onclick=resetDeviceBinding;
  $('ticketAdminSearch').onkeydown=e=>{if(e.key==='Enter')renderTicketResults();};
  $('ticketTransferCopy').onclick=()=>navigator.clipboard.writeText($('ticketTransferLink').value).then(()=>message('ticketAdminStatus','链接已复制')).catch(()=>message('ticketAdminStatus','复制失败，请手动选择链接',true));
  restoreLogin();
}
async function restoreLogin() {
  // Cookie 存在时，首屏只显示恢复提示；完成验证及数据读取后才显示后台。
  try {
    const expiresAt = await storedSessionExpiry();
    if (!expiresAt) {
      document.documentElement.dataset.adminBoot = 'login';
      $('adminPassword').focus({ preventScroll: true });
      return;
    }
    adminKey = isDemo ? 'demo' : '';
    activateSession(expiresAt);
    $('loginBtn').disabled = true;
    message('loginStatus', '正在恢复登录…');
    await refresh();
    showDashboard();
  } catch (error) {
    logout();
    message('loginStatus', `无法恢复登录：${error.message || '读取失败'}，请重新登录。`, true);
  } finally {
    $('loginBtn').disabled = false;
  }
}
init();
