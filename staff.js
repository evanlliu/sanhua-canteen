import { api, isDemo, html, localClock } from './client-api.js';
import { normalMeal, mealName, mealIcon, reservationMeal, canBookMeal, mealAvailability } from './meal-schema.js';
import { LANGUAGES, translate, detectDeviceLanguage } from './i18n.js';
const $ = id => document.getElementById(id);
const employeeInput = $('employeeInput'), dropdown = $('employeeDropdown'), dateInput = $('mealDate');
let lang = detectDeviceLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
const tr = (key,args) => translate(lang,key,args);
let state = null, selected = null, options = [], choice = -1, pending = null, requestSeq = 0, debounceTimer = null, loading = false;
let lastReservations = null;
function errorText(error) {
  const raw = String(error?.message || '');
  if (/重复预约|已预约|不能重复|重叠/.test(raw)) return tr('errDuplicate');
  if (/仅允许预约当天|预约日期不在允许范围|不在允许预约的日期/.test(raw)) return tr('errDay');
  if (/尚未到该餐次的预约时间|当前不在该餐次的预约时段/.test(raw)) return tr('errNotStarted');
  if (/暂未开放|尚未开放/.test(raw)) return tr('errClosed');
  if (/餐次今日已结束|该餐次已结束|该餐次今日已结束/.test(raw)) return tr('errEnded');
  if (/不在花名册/.test(raw)) return tr('errUnknown');
  return raw || tr('error');
}
function alertArea(text, error = true) {
  const n = $('globalStatus'); n.textContent = text; n.classList.remove('hidden'); n.classList.toggle('error', error);
}
function toast(message) {
  const n = $('toast'); n.textContent = message; n.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => n.classList.remove('show'), 3500);
}
function applyLanguage() {
  document.documentElement.lang = lang === 'es' ? 'es-MX' : lang === 'en' ? 'en' : 'zh-CN';
  document.title = tr('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n); });
  employeeInput.placeholder = tr('employeePlaceholder');
  $('lookupEmployeeId').placeholder = tr('lookupPlaceholder');
  $('languageSelect').value = lang;
  $('languageSelect').title = tr('langTitle');
  $('languageSelect').setAttribute('aria-label', tr('langTitle'));
  $('jumpToLookup').title = tr('myReservations');
  $('jumpToLookup').setAttribute('aria-label', tr('myReservations'));
  renderSelected();
  renderDropdown();
  renderMeals();
  if (lastReservations) renderReservationList(lastReservations);
}
function closeDropdown() { dropdown.classList.add('hidden'); employeeInput.setAttribute('aria-expanded', 'false'); choice = -1; }
function renderDropdown() {
  dropdown.replaceChildren();
  const q = employeeInput.value.trim();
  if (!q || selected) { closeDropdown(); return; }
  if (!q || q.length > 80) {
    const div = document.createElement('div'); div.className = 'dropdown-message'; div.textContent = tr('invalidSearch'); dropdown.append(div);
  } else if (options.length === 0) {
    const div = document.createElement('div'); div.className = 'dropdown-message'; div.textContent = tr('noEmployee'); dropdown.append(div);
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
function renderSelected() {
  const chip = $('selectedEmployee'); chip.replaceChildren();
  if (!selected) { chip.classList.add('hidden'); return; }
  chip.classList.remove('hidden');
  const label = document.createElement('span'); label.textContent = '✓ ' + tr('selected', {name:selected.name,id:selected.employeeId});
  const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = tr('changeEmployee');
  clear.onclick = () => { selected = null; employeeInput.value = ''; options=[]; chip.classList.add('hidden'); employeeInput.focus(); renderMeals(); };
  chip.append(label, clear);
}
function selectEmployee(e) {
  selected = e; employeeInput.value = e.employeeId; options = []; requestSeq++; closeDropdown();
  renderSelected(); $('lookupEmployeeId').value = e.employeeId; renderMeals();
}
function scheduleSearch() {
  selected = null; renderSelected(); renderMeals();
  clearTimeout(debounceTimer); const q = employeeInput.value.trim(); requestSeq++;
  // Invalidate results from the previous ID/name query immediately.
  options = []; choice = -1; closeDropdown();
  if (!q || q.length > 80) { renderDropdown(); return; }
  const seq = requestSeq;
  debounceTimer = setTimeout(async () => {
    dropdown.replaceChildren();
    const div = document.createElement('div'); div.className = 'dropdown-message'; div.textContent=tr('searching'); dropdown.append(div);
    dropdown.classList.remove('hidden');
    try { const data = await api('/api/employees/search?q=' + encodeURIComponent(q)); if (seq !== requestSeq) return; options = data.employees || []; choice = -1; renderDropdown(); }
    catch (error) { if (seq !== requestSeq) return; closeDropdown(); alertArea(errorText(error)); }
  }, 260);
}
function renderMeals() {
  const grid = $('mealsGrid');
  if (!state) return;
  const { today, nowTime } = localClock(state.settings.timeZone);
  // Display ALL meals enabled for employees. Booking permission is evaluated
  // independently so a meal that has not started or has ended remains visible.
  const visibleMeals = state.settings.meals.map(normalMeal).filter(meal => meal.enabled);
  if (!visibleMeals.length) {
    grid.innerHTML = `<div class="panel meals-empty" role="status">${html(tr('noEnabledMeals'))}</div>`;
    return;
  }
  grid.innerHTML = visibleMeals.map(meal => {
    const availability = mealAvailability(meal, today, dateInput.dataset.date, nowTime);
    const canBook = availability === 'open';
    const statusKey = availability === 'upcoming' ? 'notStarted' : availability === 'ended' ? 'ended' : canBook ? 'open' : 'closed';
    const buttonKey = availability === 'upcoming' ? 'notStartedBtn' : availability === 'ended' ? 'endedBtn' : canBook ? 'bookNow' : 'closedBtn';
    return `<article class="meal-card${canBook ? '' : ' disabled'}"><div class="meal-top"><span class="meal-emoji">${mealIcon(meal.id)}</span><span class="pill${canBook ? '' : ' lock'}">${html(tr(statusKey))}</span></div><h3>${html(mealName(meal,lang))}</h3><div class="subtitle">${lang==='zh' ? html(meal.nameEs) : ''}</div><div class="meal-time">⏱ ${html(meal.start)} – ${html(meal.end)}</div><button class="action" data-meal="${html(meal.id)}" ${(!canBook || loading) ? 'disabled' : ''}>${html(tr(buttonKey))}</button></article>`;
  }).join('');
  grid.querySelectorAll('[data-meal]:not(:disabled)').forEach(btn => btn.addEventListener('click', () => openReserve(btn.dataset.meal)));
}
function openReserve(mealId) {
  if (!selected) { toast(tr('chooseEmployee')); employeeInput.focus(); return; }
  if (!dateInput.dataset.date) { toast(tr('dateInvalid')); return; }
  const meal = state?.settings.meals.find(m => m.id === mealId);
  const { today, nowTime } = localClock(state.settings.timeZone);
  if (!meal?.enabled) return;
  if (!canBookMeal(meal, today, dateInput.dataset.date, nowTime)) {
    toast(nowTime < meal.start ? tr('errNotStarted') : nowTime >= meal.end ? tr('errEnded') : tr('errDay'));
    renderMeals();
    return;
  }
  pending = { employeeId: selected.employeeId, mealId, date: dateInput.dataset.date };
  $('modalEmoji').textContent = mealIcon(mealId); $('modalTitle').textContent = tr('confirmTitle', {meal:mealName(meal,lang)});
  $('modalText').textContent = tr('confirmDesc');
  $('modalDetail').innerHTML = `${html(tr('name'))}: <strong>${html(selected.name)}</strong><br>${html(tr('staffNumber'))}: <strong>${html(selected.employeeId)}</strong><br>${html(tr('date'))}: <strong>${html(dateInput.dataset.date)}</strong><br>${html(tr('time'))}: <strong>${html(meal.start)} – ${html(meal.end)}</strong>`;
  $('modalStatus').textContent = ''; $('modalStatus').classList.remove('error'); $('confirmBtn').textContent = tr('confirm'); $('confirmBtn').disabled = false; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = tr('goBack');
  $('reserveModal').classList.add('on'); $('reserveModal').setAttribute('aria-hidden', 'false'); $('confirmBtn').focus();
}
function closeReserve() { if (loading) return; $('reserveModal').classList.remove('on'); $('reserveModal').setAttribute('aria-hidden', 'true'); pending = null; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = tr('goBack'); }
async function submitReservation() {
  if (loading || !pending) return;
  loading = true; $('confirmBtn').disabled = true; $('cancelBtn').disabled = true;
  $('confirmBtn').textContent = tr('submitting'); renderMeals();
  try {
    const result = await api('/api/reservations', { method: 'POST', body: pending });
    const r = result.reservation;
    $('modalTitle').textContent = tr('successTitle'); $('modalEmoji').textContent = '✅';
    $('modalText').textContent = tr('successDesc');
    $('modalDetail').innerHTML = `${html(tr('reservationNumber'))}<br><strong style="font-size:30px;letter-spacing:2px">${html(r.id)}</strong><br>${html(r.date)} · ${html(reservationMeal(r,state.settings.meals,lang))} · ${html(r.mealStart)}–${html(r.mealEnd)}`;
    $('confirmBtn').textContent = tr('myReservations'); $('confirmBtn').disabled = false;
    $('cancelBtn').textContent = tr('close'); $('cancelBtn').disabled = false;
    $('confirmBtn').onclick = () => { loading = false; closeReserve(); $('lookupEmployeeId').value = r.employeeId; lookup(); jumpToLookup(); };
    toast(tr('savedToast',{code:r.id}));
  } catch (error) { $('modalStatus').textContent = errorText(error); $('modalStatus').classList.add('error'); $('confirmBtn').disabled = false; }
  finally { loading = false; if ($('confirmBtn').textContent === tr('submitting')) $('confirmBtn').textContent = tr('retry'); $('cancelBtn').disabled = false; renderMeals(); }
}
function renderReservationList(rows) {
  const result = $('reservationList');
  result.innerHTML = rows.map(r => `<article class="res-item"><div><strong>${html(r.date)} · ${html(reservationMeal(r,state?.settings.meals||[],lang))}</strong><small>${html(r.employeeName)} · ${html(tr('staffNumber'))} ${html(r.employeeId)}<br>⏱ ${html(r.mealStart)}–${html(r.mealEnd)} · ${html(tr('booked'))}</small></div><div class="code">#${html(r.id)}</div></article>`).join('');
  $('lookupStatus').textContent = rows.length ? tr('found',{count:rows.length}) : tr('notFound');
}
async function lookup() {
  const employeeId = $('lookupEmployeeId').value.trim(), result = $('reservationList'), status = $('lookupStatus');
  lastReservations = null; result.replaceChildren(); status.textContent = ''; status.className = 'status';
  if (!/^\d{1,24}$/.test(employeeId)) { status.textContent = tr('invalidId'); status.classList.add('error'); return; }
  $('lookupBtn').disabled = true; $('lookupBtn').textContent = tr('querying');
  try { const response = await api('/api/reservations/my?employeeId=' + encodeURIComponent(employeeId)); lastReservations = response.reservations || []; renderReservationList(lastReservations); }
  catch (error) { status.textContent = errorText(error); status.classList.add('error'); }
  finally { $('lookupBtn').disabled = false; $('lookupBtn').textContent = tr('lookupBtn'); }
}
function jumpToLookup(event) {
  event?.preventDefault();
  if (selected && !$('lookupEmployeeId').value.trim()) $('lookupEmployeeId').value = selected.employeeId;
  $('myReservations').scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Focus input without additional page scroll once the smooth scrolling begins.
  $('lookupEmployeeId').focus({preventScroll:true});
}
async function init() {
  if (isDemo) $('demoHint').classList.remove('hidden');
  $('languageSelect').addEventListener('change', event => {
    if (!LANGUAGES.includes(event.target.value)) return;
    lang = event.target.value;
    applyLanguage();
  });
  $('jumpToLookup').addEventListener('click',jumpToLookup);
  employeeInput.addEventListener('input', scheduleSearch);
  employeeInput.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') closeDropdown();
    if (!options.length) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); choice = (choice + 1) % options.length; renderDropdown(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); choice = (choice - 1 + options.length) % options.length; renderDropdown(); }
    if (ev.key === 'Enter' && !dropdown.classList.contains('hidden')) { ev.preventDefault(); selectEmployee(options[choice < 0 ? 0 : choice]); }
  });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-wrap')) closeDropdown(); });
  $('lookupBtn').addEventListener('click', lookup);
  $('lookupEmployeeId').addEventListener('keydown', ev => { if (ev.key === 'Enter') lookup(); });
  $('closeModal').onclick = closeReserve; $('cancelBtn').onclick = closeReserve;
  $('confirmBtn').onclick = submitReservation;
  $('reserveModal').addEventListener('click', ev => { if (ev.target === $('reserveModal')) closeReserve(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeReserve(); });
  applyLanguage();
  employeeInput.focus();
  try {
    state = await api('/api/config');
    // Display wall-clock time in the configured canteen timezone, without allowing editing.
    // Booking payloads continue to send the canonical yyyy-MM-dd date only.
    const updateAvailability = () => {
      const clock = localClock(state.settings.timeZone);
      const stamp = `${clock.today} ${clock.nowTime}`;
      if (dateInput.value === stamp && dateInput.dataset.date === clock.today) return;
      dateInput.dataset.date = clock.today;
      dateInput.value = stamp;
      renderMeals();
    };
    updateAvailability();
    setInterval(updateAvailability, 10_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateAvailability();
    });
  } catch (error) { $('mealsGrid').innerHTML = ''; alertArea(errorText(error)); }
}
init();
