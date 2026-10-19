import { api, isDemo, html, mealTitle, formatTime } from './client-api.js';
import { readXlsxRows } from './xlsx-reader.js';
const $ = id => document.getElementById(id);
let adminKey = '', db = null, rosterFileRows = null, busy = false;
let filtered = [];
function message(id, text = '', error = false) { const e = $(id); e.textContent = text; e.classList.toggle('error', error); }
function adminAlert(text, error = false) { const e = $('adminAlert'); e.textContent = text; e.classList.remove('hidden'); e.classList.toggle('error', error); }
function authApi(path, opts = {}) { return api(path, { ...opts, adminKey }); }
function onError(error, target = 'adminAlert') {
  const text = error?.message || '操作失败';
  if (target === 'adminAlert') adminAlert(text, true); else message(target, text, true);
  if (error?.status === 401 && !isDemo) logout();
}
async function login(event) {
  event?.preventDefault();
  const password = $('adminPassword').value;
  if (!password) return message('loginStatus', '请输入有 sanhua-canteen 仓库权限的 GitHub Token', true);
  adminKey = password;
  $('loginBtn').disabled = true; message('loginStatus', '正在验证身份…');
  try { await refresh(); $('adminPassword').value = ''; $('loginArea').classList.add('hidden'); $('dashboardArea').classList.remove('hidden'); $('logoutBtn').classList.remove('hidden'); message('loginStatus'); }
  catch (error) { adminKey = ''; message('loginStatus', error.message || '登录失败', true); }
  finally { $('loginBtn').disabled = false; }
}
function logout() { adminKey = ''; db = null; $('dashboardArea').classList.add('hidden'); $('loginArea').classList.remove('hidden'); $('logoutBtn').classList.add('hidden'); $('adminPassword').value = ''; $('adminPassword').focus(); }
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
  $('statLunch').textContent = db.reservations.filter(x => x.date === db.today && x.mealId === 'lunch').length;
  $('statDinner').textContent = db.reservations.filter(x => x.date === db.today && x.mealId === 'dinner').length;
  $('todayLabel').textContent = `用餐日期：${db.today}`;
  renderBookings(); renderRoster(); renderSettings();
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
    tbody.innerHTML = '<tr><td colspan="8" class="admin-empty">暂无符合条件的预约记录</td></tr>';
    mobile.innerHTML = '<div class="admin-empty">暂无符合条件的预约记录</div>'; return;
  }
  for (const row of filtered) {
    const tr = document.createElement('tr');
    for (const [val, klass] of [[row.id, 'id-cell'], [row.employeeId, ''], [row.employeeName, ''], [mealTitle(row.mealId), ''], [row.date, ''], [`${row.mealStart} – ${row.mealEnd}`, ''], [formatTime(row.createdAt), '']]) {
      const td = document.createElement('td'); td.textContent = val ?? ''; if (klass) td.className = klass; tr.append(td);
    }
    const action = document.createElement('td'), del = document.createElement('button');
    del.className = 'action danger small'; del.textContent = '删除'; del.disabled = busy;
    del.addEventListener('click', () => removeBooking(row)); action.append(del); tr.append(action); tbody.append(tr);
    const card = document.createElement('article'); card.className = 'admin-entry';
    card.innerHTML = `<div class="item-head"><strong>${html(row.employeeName)} · ${html(mealTitle(row.mealId))}</strong><span class="id-cell">#${html(row.id)}</span></div><div class="item-meta">工号 ${html(row.employeeId)}<br>用餐 ${html(row.date)} · ${html(row.mealStart)}–${html(row.mealEnd)}<br>提交于 ${html(formatTime(row.createdAt))}</div>`;
    const d = del.cloneNode(true); d.addEventListener('click', () => removeBooking(row)); card.append(d); mobile.append(card);
  }
}
async function removeBooking(row) {
  if (busy) return;
  if (!confirm(`确认删除预约吗？\n\n${row.employeeName}（${row.employeeId}）\n${row.date} · ${mealTitle(row.mealId)}\n预约编号：${row.id}\n\n删除后该员工可重新预约此餐次。`)) return;
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
  if (!subset.length) { tbody.innerHTML = '<tr><td colspan="2" class="admin-empty">没有匹配的员工</td></tr>'; }
  for (const e of subset.slice(0, 100)) {
    const tr = document.createElement('tr');
    for (const val of [e.employeeId, e.name]) { const td = document.createElement('td'); td.textContent = val; tr.append(td); }
    tbody.append(tr);
  }
  $('rosterNote').textContent = subset.length > 100 ? '为保证页面流畅，仅显示前 100 条，请使用搜索框缩小范围。' : '';
}
function renderSettings() {
  if (!db) return;
  $('timezoneInput').value = db.settings.timeZone;
  $('advanceInput').value = db.settings.maxAdvanceDays;
  $('configCards').innerHTML = db.settings.meals.map(m => `<article class="config-card" data-id="${html(m.id)}"><div class="flex" style="justify-content:space-between"><h3>${({ breakfast: '🥐', lunch: '🍚', dinner: '🍲' })[m.id]} ${html(mealTitle(m.id))}</h3><span class="pill">${html(m.id)}</span></div><p class="muted">员工用餐时间区间</p><div class="times"><label><span class="label">开始时间</span><input class="control meal-start" type="time" value="${html(m.start)}" required></label><label><span class="label">结束时间</span><input class="control meal-end" type="time" value="${html(m.end)}" required></label></div><label class="toggle-line"><input type="checkbox" class="meal-enabled" ${m.enabled ? 'checked' : ''}> 开放员工预约此餐次</label></article>`).join('');
}
async function saveSettings() {
  if (!db || busy) return;
  const meals = [...document.querySelectorAll('#configCards [data-id]')].map(el => ({ id: el.dataset.id, label: mealTitle(el.dataset.id), start: el.querySelector('.meal-start').value, end: el.querySelector('.meal-end').value, enabled: el.querySelector('.meal-enabled').checked }));
  for (const m of meals) if (!/^\d{2}:\d{2}$/.test(m.start) || !/^\d{2}:\d{2}$/.test(m.end) || m.end <= m.start) return message('settingsStatus', `${mealTitle(m.id)}结束时间必须晚于开始时间`, true);
  const settings = { timeZone: $('timezoneInput').value.trim(), maxAdvanceDays: Number($('advanceInput').value), meals };
  if (!settings.timeZone || !Number.isInteger(settings.maxAdvanceDays) || settings.maxAdvanceDays < 0 || settings.maxAdvanceDays > 60) return message('settingsStatus', '时区或提前预约天数无效', true);
  busy = true; $('saveSettingsBtn').disabled = true; message('settingsStatus', '正在保存…');
  try { await authApi('/api/admin/settings', { method: 'PUT', body: settings }); await refresh(); message('settingsStatus', '✓ 时间设置已保存，员工端刷新后生效。'); }
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
  const headers = rows[0].map(canonical);
  const idIndex = headers.findIndex(t => ['工号', '员工工号', 'employeeid', 'id', 'númerodeempleado', 'numeroempleado'].includes(t));
  const nameIndex = headers.findIndex(t => ['姓名', '员工姓名', 'name', 'nombre', 'employeename'].includes(t));
  if (idIndex < 0 || nameIndex < 0) throw new Error('第一行必须包含“工号”和“姓名”表头');
  const seen = new Set(), employees = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const employeeId = String(row[idIndex] ?? '').trim(), name = String(row[nameIndex] ?? '').trim();
    if (!employeeId && !name) continue;
    if (!/^\d{1,24}$/.test(employeeId)) throw new Error(`Excel 第 ${i + 1} 行：工号必须为纯数字，无法使用科学计数法`);
    if (!name || name.length > 80) throw new Error(`Excel 第 ${i + 1} 行：姓名为空或超过 80 字`);
    if (seen.has(employeeId)) throw new Error(`Excel 第 ${i + 1} 行：工号 ${employeeId} 在文件中重复`);
    seen.add(employeeId); employees.push({ employeeId, name });
  }
  if (!employees.length) throw new Error('没有有效的员工资料');
  if (employees.length > 15000) throw new Error('一次最多导入 15000 名员工');
  return employees;
}
async function readFile() {
  const file = $('rosterFile').files?.[0]; if (!file) return;
  rosterFileRows = null; $('importBtn').disabled = true; $('filePreview').classList.add('hidden');
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
    rosterFileRows = parseEmployees(rows);
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
    const result = await authApi('/api/admin/import-roster', { method: 'POST', body: { mode, employees: rosterFileRows } });
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
  const data = [['预约号', '员工工号', '员工姓名', '餐次', '用餐日期', '开始时间', '结束时间', '预约提交时间'],
    ...filtered.map(r => [r.id, r.employeeId, r.employeeName, mealTitle(r.mealId), r.date, r.mealStart, r.mealEnd, formatTime(r.createdAt)])];
  const csv = '\uFEFF' + data.map(r => r.map(csvSafe).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `食堂预约记录_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function selectTab(tab) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(x => x.classList.toggle('active', x.id === 'tab-' + tab));
}
function init() {
  if (isDemo) { $('demoLoginBtn').classList.remove('hidden'); $('demoAdminHint').classList.remove('hidden'); }
  $('loginForm').addEventListener('submit', login);
  $('demoLoginBtn').onclick = () => { $('adminPassword').value = 'demo'; login(); };
  $('logoutBtn').onclick = logout;
  $('refreshBtn').onclick = () => refresh().catch(e => onError(e));
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => selectTab(btn.dataset.tab));
  for (const id of ['fKeyword', 'fDate', 'fEmployeeId', 'fMeal']) $(id).addEventListener('input', renderBookings);
  $('resetFilterBtn').onclick = () => { ['fKeyword', 'fDate', 'fEmployeeId', 'fMeal'].forEach(id => $(id).value = ''); renderBookings(); };
  $('exportBtn').onclick = exportCSV;
  $('rosterFilter').oninput = renderRoster;
  $('rosterFile').onchange = readFile;
  $('importBtn').onclick = importRoster;
  $('saveSettingsBtn').onclick = saveSettings;
}
init();
