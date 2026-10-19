import { api, isDemo, html, dateOffset, mealTitle, localClock } from './client-api.js';
const $ = id => document.getElementById(id);
const employeeInput = $('employeeInput'), dropdown = $('employeeDropdown'), dateInput = $('mealDate');
let state = null, selected = null, options = [], choice = -1, pending = null, requestSeq = 0, debounceTimer = null, loading = false;
const mealIcons = { breakfast: '🥐', lunch: '🍚', dinner: '🍲' };
const mealSubtitles = { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena' };
const errText = err => err?.message || '系统繁忙，请稍后重试';
function alertArea(text, error = true) {
  const n = $('globalStatus'); n.textContent = text; n.classList.remove('hidden'); n.classList.toggle('error', error);
}
function toast(message) {
  const n = $('toast'); n.textContent = message; n.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => n.classList.remove('show'), 3500);
}
function closeDropdown() { dropdown.classList.add('hidden'); employeeInput.setAttribute('aria-expanded', 'false'); choice = -1; }
function renderDropdown() {
  dropdown.replaceChildren();
  if (!employeeInput.value.trim()) { closeDropdown(); return; }
  if (employeeInput.value.trim().length < 4) {
    const div = document.createElement('div'); div.className = 'dropdown-message'; div.textContent = '请输入至少 4 位工号'; dropdown.append(div);
  } else if (options.length === 0) {
    const div = document.createElement('div'); div.className = 'dropdown-message'; div.textContent = '没有匹配的员工，请确认工号'; dropdown.append(div);
  } else {
    options.forEach((e, i) => {
      const item = document.createElement('div'); item.className = 'dropdown-item' + (choice === i ? ' active' : ''); item.setAttribute('role', 'option');
      const code = document.createElement('span'); code.textContent = e.employeeId;
      const name = document.createElement('small'); name.textContent = e.name;
      item.append(code, name); item.addEventListener('mousedown', ev => ev.preventDefault()); item.addEventListener('click', () => selectEmployee(e)); dropdown.append(item);
    });
  }
  dropdown.classList.remove('hidden'); employeeInput.setAttribute('aria-expanded', 'true');
}
function selectEmployee(e) {
  selected = e; employeeInput.value = e.employeeId; options = []; requestSeq++; closeDropdown();
  const chip = $('selectedEmployee'); chip.classList.remove('hidden'); chip.replaceChildren();
  const label = document.createElement('span'); label.textContent = `✓ 已选择：${e.name}（${e.employeeId}）`;
  const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '更换员工'; clear.onclick = () => { selected = null; employeeInput.value = ''; chip.classList.add('hidden'); employeeInput.focus(); renderMeals(); };
  chip.append(label, clear); $('lookupEmployeeId').value = e.employeeId; renderMeals();
}
function scheduleSearch() {
  selected = null; $('selectedEmployee').classList.add('hidden'); renderMeals();
  clearTimeout(debounceTimer); const q = employeeInput.value.trim(); requestSeq++;
  if (!/^\d{4,24}$/.test(q)) { options = []; renderDropdown(); return; }
  const seq = requestSeq;
  debounceTimer = setTimeout(async () => {
    dropdown.classList.remove('hidden'); dropdown.innerHTML = '<div class="dropdown-message">正在搜索员工…</div>';
    try { const data = await api('/api/employees/search?q=' + encodeURIComponent(q)); if (seq !== requestSeq) return; options = data.employees || []; choice = -1; renderDropdown(); }
    catch (error) { if (seq !== requestSeq) return; closeDropdown(); alertArea(errText(error)); }
  }, 260);
}
function renderMeals() {
  const grid = $('mealsGrid');
  if (!state) return;
  const { today, nowTime } = localClock(state.settings.timeZone);
  const date = dateInput.value;
  grid.innerHTML = state.settings.meals.map(meal => {
    const todayEnded = date === today && nowTime >= meal.end;
    const disabled = !meal.enabled || todayEnded;
    const status = !meal.enabled ? '暂未开放' : todayEnded ? '今日已结束' : '开放预约';
    const reason = !meal.enabled ? '餐次暂未开放' : todayEnded ? '本餐今日结束' : '立即预约 / Reservar';
    return `<article class="meal-card ${disabled ? 'disabled' : ''}"><div class="meal-top"><span class="meal-emoji">${mealIcons[meal.id] || '🍽️'}</span><span class="pill ${disabled ? 'lock' : ''}">${status}</span></div><h3>${html(mealTitle(meal.id))}</h3><div class="subtitle">${mealSubtitles[meal.id] || ''}</div><div class="meal-time">⏱ ${html(meal.start)} – ${html(meal.end)}</div><button class="action" data-meal="${html(meal.id)}" ${disabled || loading ? 'disabled' : ''}>${reason}</button></article>`;
  }).join('');
  grid.querySelectorAll('[data-meal]').forEach(btn => btn.addEventListener('click', () => openReserve(btn.dataset.meal)));
}
function openReserve(mealId) {
  if (!selected) { toast('请先通过工号下拉列表选择员工'); employeeInput.focus(); return; }
  if (!dateInput.value) { toast('请选择用餐日期'); dateInput.focus(); return; }
  const meal = state.settings.meals.find(m => m.id === mealId);
  if (!meal?.enabled) return;
  pending = { employeeId: selected.employeeId, mealId, date: dateInput.value };
  $('modalEmoji').textContent = mealIcons[mealId] || '🍽️'; $('modalTitle').textContent = `确认预约${mealTitle(mealId)}`;
  $('modalText').textContent = '请核对员工信息与用餐日期，确认后会自动生成预约号码。';
  $('modalDetail').innerHTML = `员工姓名：<strong>${html(selected.name)}</strong><br>员工工号：<strong>${html(selected.employeeId)}</strong><br>用餐日期：<strong>${html(dateInput.value)}</strong><br>用餐时段：<strong>${html(meal.start)} – ${html(meal.end)}</strong>`;
  $('modalStatus').textContent = ''; $('modalStatus').classList.remove('error'); $('confirmBtn').textContent = '确认预约'; $('confirmBtn').disabled = false; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = '返回修改';
  $('reserveModal').classList.add('on'); $('reserveModal').setAttribute('aria-hidden', 'false'); $('confirmBtn').focus();
}
function closeReserve() { if (loading) return; $('reserveModal').classList.remove('on'); $('reserveModal').setAttribute('aria-hidden', 'true'); pending = null; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = '返回修改'; }
async function submitReservation() {
  if (loading || !pending) return;
  loading = true; $('confirmBtn').disabled = true; $('cancelBtn').disabled = true;
  $('confirmBtn').textContent = '正在提交…'; renderMeals();
  try {
    const result = await api('/api/reservations', { method: 'POST', body: pending });
    const r = result.reservation;
    $('modalTitle').textContent = '预约成功！'; $('modalEmoji').textContent = '✅';
    $('modalText').textContent = '请保存下面的预约号码，用餐时可向工作人员出示。';
    $('modalDetail').innerHTML = `预约号码<br><strong style="font-size:30px;letter-spacing:2px">${html(r.id)}</strong><br>${html(r.date)} · ${html(mealTitle(r.mealId))} · ${html(r.mealStart)}–${html(r.mealEnd)}`;
    $('confirmBtn').textContent = '查看我的预约'; $('confirmBtn').disabled = false;
    $('cancelBtn').textContent = '关闭'; $('cancelBtn').disabled = false;
    $('confirmBtn').onclick = () => { loading = false; closeReserve(); $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = '返回修改'; $('lookupEmployeeId').value = r.employeeId; lookup(); $('myReservations').scrollIntoView({ behavior: 'smooth' }); };
    toast('预约成功，请保存号码 ' + r.id);
  } catch (error) { $('modalStatus').textContent = errText(error); $('modalStatus').classList.add('error'); $('confirmBtn').disabled = false; }
  finally { loading = false; if ($('confirmBtn').textContent === '正在提交…') $('confirmBtn').textContent = '重新提交'; $('cancelBtn').disabled = false; renderMeals(); }
}
async function lookup() {
  const employeeId = $('lookupEmployeeId').value.trim(), result = $('reservationList'), status = $('lookupStatus');
  result.replaceChildren(); status.textContent = ''; status.className = 'status';
  if (!/^\d{1,24}$/.test(employeeId)) { status.textContent = '请输入完整的数字工号'; status.classList.add('error'); return; }
  $('lookupBtn').disabled = true; $('lookupBtn').textContent = '查询中…';
  try {
    const response = await api('/api/reservations/my?employeeId=' + encodeURIComponent(employeeId));
    const rows = response.reservations || [];
    if (!rows.length) { status.textContent = '未找到预约记录，可以先选择餐次进行预约。'; return; }
    status.textContent = `共找到 ${rows.length} 条预约记录`;
    result.innerHTML = rows.map(r => `<article class="res-item"><div><strong>${html(r.date)} · ${html(mealTitle(r.mealId))}</strong><small>${html(r.employeeName)} · 工号 ${html(r.employeeId)}<br>⏱ ${html(r.mealStart)}–${html(r.mealEnd)} · 已预约</small></div><div class="code">#${html(r.id)}</div></article>`).join('');
  } catch (error) { status.textContent = errText(error); status.classList.add('error'); }
  finally { $('lookupBtn').disabled = false; $('lookupBtn').textContent = '查询预约'; }
}
async function init() {
  if (isDemo) {
    $('demoHint').classList.remove('hidden');
  }
  employeeInput.addEventListener('input', scheduleSearch);
  employeeInput.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeDropdown();
    if (!options.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); choice = (choice + 1) % options.length; renderDropdown(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); choice = (choice - 1 + options.length) % options.length; renderDropdown(); }
    if (ev.key === 'Enter' && !dropdown.classList.contains('hidden')) { ev.preventDefault(); selectEmployee(options[choice < 0 ? 0 : choice]); }
  });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-wrap')) closeDropdown(); });
  dateInput.addEventListener('change', renderMeals);
  $('lookupBtn').addEventListener('click', lookup);
  $('lookupEmployeeId').addEventListener('keydown', ev => { if (ev.key === 'Enter') lookup(); });
  $('closeModal').onclick = closeReserve; $('cancelBtn').onclick = closeReserve;
  $('confirmBtn').onclick = submitReservation;
  $('reserveModal').addEventListener('click', ev => { if (ev.target === $('reserveModal')) closeReserve(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeReserve(); });
  try {
    state = await api('/api/config');
    dateInput.min = state.today; dateInput.max = dateOffset(state.today, state.settings.maxAdvanceDays); dateInput.value = state.today;
    $('dateTip').textContent = `允许预约 ${state.today} 至 ${dateInput.max} · 用餐时区 ${state.settings.timeZone}`;
    renderMeals();
  } catch (error) { $('mealsGrid').innerHTML = ''; alertArea(errText(error)); }
}
init();
