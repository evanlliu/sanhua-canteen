import { api, isDemo, html, localClock } from './client-api.js';
import { normalMeal, mealName, mealIcon, reservationMeal, canBookMeal, mealAvailability } from './meal-schema.js';
import { LANGUAGES, translate, detectDeviceLanguage } from './i18n.js';
import { plantLabel, validPlant } from './plant-schema.js';
import { newTicketIdentity, ticketListLoad, putLocalTicket, acceptTransferFromFragment } from './ticket-storage.js';
import { CLAIM_DURATION_MS, visualMarker } from './ticket-schema.js';
const $ = id => document.getElementById(id);
const employeeInput = $('employeeInput'), dropdown = $('employeeDropdown'), dateInput = $('mealDate');
let lang = detectDeviceLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
const tr = (key,args) => translate(lang,key,args);
let state = null, selected = null, options = [], choice = -1, pending = null, requestSeq = 0, debounceTimer = null, loading = false;
let lastReservations = null;
let ownedTickets = [], activeTicket = null, ticketBusy = false, slideDirection = 1, swipeActive = false, swipeStart = 0, swipeProgress = 0, successTimer = null;
function errorText(error) {
  const raw = String(error?.message || '');
  if (/重复预约|已预约|不能重复|重叠/.test(raw)) return tr('errDuplicate');
  if (/仅允许预约当天|预约日期不在允许范围|不在允许预约的日期/.test(raw)) return tr('errDay');
  if (/尚未到该餐次的预约时间|当前不在该餐次的预约时段/.test(raw)) return tr('errNotStarted');
  if (/暂未开放|尚未开放/.test(raw)) return tr('errClosed');
  if (/餐次今日已结束|该餐次已结束|该餐次今日已结束/.test(raw)) return tr('errEnded');
  if (/请选择 Plant|Plant 无效/.test(raw)) return tr('choosePlant');
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

  $('languageSelect').value = lang;
  $('languageSelect').title = tr('langTitle');
  $('languageSelect').setAttribute('aria-label', tr('langTitle'));
  $('jumpToLookup').title = tr('myReservations');
  $('jumpToLookup').setAttribute('aria-label', tr('myReservations'));
  renderSelected();
  renderDropdown();
  renderMeals();
  if (lastReservations) renderReservationList(lastReservations);
  if (activeTicket && !ticketBusy) updateTicketModalText();
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
  renderSelected(); renderMeals();
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
  const plant = $('plantSelect').value;
  if (!validPlant(plant)) { toast(tr('choosePlant')); $('plantSelect').focus(); return; }
  const meal = state?.settings.meals.find(m => m.id === mealId);
  const { today, nowTime } = localClock(state.settings.timeZone);
  if (!meal?.enabled) return;
  if (!canBookMeal(meal, today, dateInput.dataset.date, nowTime)) {
    toast(nowTime < meal.start ? tr('errNotStarted') : nowTime >= meal.end ? tr('errEnded') : tr('errDay'));
    renderMeals();
    return;
  }
  pending = { employeeId: selected.employeeId, mealId, date: dateInput.dataset.date, plant };
  $('modalEmoji').textContent = mealIcon(mealId); $('modalTitle').textContent = tr('confirmTitle', {meal:mealName(meal,lang)});
  $('modalText').textContent = tr('confirmDesc');
  $('modalDetail').innerHTML = `${html(tr('name'))}: <strong>${html(selected.name)}</strong><br>${html(tr('staffNumber'))}: <strong>${html(selected.employeeId)}</strong><br>${html(tr('date'))}: <strong>${html(dateInput.dataset.date)}</strong><br>${html(tr('time'))}: <strong>${html(meal.start)} – ${html(meal.end)}</strong><br>${html(tr('plantLabel'))}: <strong>${html(plantLabel(plant))}</strong>`;
  $('modalStatus').textContent = ''; $('modalStatus').classList.remove('error'); $('confirmBtn').textContent = tr('confirm'); $('confirmBtn').disabled = false; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = tr('goBack');
  $('reserveModal').classList.add('on'); $('reserveModal').setAttribute('aria-hidden', 'false'); $('confirmBtn').focus();
}
function closeReserve() { if (loading) return; $('reserveModal').classList.remove('on'); $('reserveModal').setAttribute('aria-hidden', 'true'); pending = null; $('confirmBtn').onclick = submitReservation; $('cancelBtn').textContent = tr('goBack'); }
async function submitReservation() {
  if (loading || !pending) return;
  loading = true; $('confirmBtn').disabled = true; $('cancelBtn').disabled = true;
  $('confirmBtn').textContent = tr('submitting'); renderMeals();
  try {
    const identity = await newTicketIdentity();
    // Save a pending claim before the network request, so ambiguous network errors can be reconciled.
    putLocalTicket(localStorage,{secret:identity.secret,pending:true,createdAt:new Date().toISOString()});
    const result = await api('/api/reservations', { method: 'POST', body: {...pending,credentialHash:identity.credentialHash} });
    const r = result.reservation;
    putLocalTicket(localStorage,{id:r.id,secret:identity.secret,createdAt:r.createdAt});
    $('modalTitle').textContent = tr('successTitle'); $('modalEmoji').textContent = '✅';
    $('modalText').textContent = tr('successDesc');
    $('modalDetail').innerHTML = `${html(tr('reservationNumber'))}<br><strong style="font-size:30px;letter-spacing:2px">${html(r.id)}</strong><br>${html(r.date)} · ${html(reservationMeal(r,state.settings.meals,lang))} · ${html(r.mealStart)}–${html(r.mealEnd)} · ${html(plantLabel(r.plant))}`;
    $('confirmBtn').textContent = tr('myReservations'); $('confirmBtn').disabled = false;
    $('cancelBtn').textContent = tr('close'); $('cancelBtn').disabled = false;
    $('confirmBtn').onclick = () => { loading = false; closeReserve(); loadMyTickets(); jumpToLookup(); };
    loadMyTickets();
    toast(tr('savedToast',{code:r.id}));
  } catch (error) { $('modalStatus').textContent = errorText(error); $('modalStatus').classList.add('error'); $('confirmBtn').disabled = false; }
  finally { loading = false; if ($('confirmBtn').textContent === tr('submitting')) $('confirmBtn').textContent = tr('retry'); $('cancelBtn').disabled = false; renderMeals(); }
}
function availabilityText(code) {
  return ({ open:'ticketOpen', used:'ticketUsed', early:'ticketEarly', late:'ticketLate', disabled:'ticketDisabled', day:'ticketDay', exception:'ticketException', missing:'ticketInvalid' })[code] || 'ticketInvalid';
}
function renderReservationList(rows) {
  const result=$('reservationList');result.replaceChildren();
  if (!rows.length) { $('lookupStatus').textContent=tr('ticketNone'); return; }
  $('lookupStatus').textContent=tr('ticketCount',{count:rows.length});
  for (const info of rows) {
    const r=info.reservation, card=document.createElement('article');card.className='res-item ticket-item';
    const left=document.createElement('div');
    const head=document.createElement('strong');head.textContent=`${r.date} · ${reservationMeal(r,state?.settings.meals||[],lang)}`;
    const desc=document.createElement('small');desc.textContent=`Plant ${r.plant||'?'} · ${r.mealStart}–${r.mealEnd} · ${tr(availabilityText(info.eligibility))}`;
    left.append(head,desc);
    const controls=document.createElement('div');controls.className='ticket-item-actions';
    const code=document.createElement('div');code.className='code';code.textContent='#'+r.id;
    const btn=document.createElement('button');btn.className='action small';btn.textContent=tr(info.eligibility==='open'?'ticketOpenButton':availabilityText(info.eligibility));
    btn.disabled=info.eligibility!=='open';btn.onclick=()=>openTicket(info);
    controls.append(code,btn);card.append(left,controls);result.append(card);
  }
}
async function loadMyTickets() {
  const status=$('lookupStatus');status.textContent=tr('ticketLoading');
  const saved=ticketListLoad(localStorage);
  if (!saved.length) {ownedTickets=[];lastReservations=[];renderReservationList([]);return;}
  const results=await Promise.allSettled(saved.map(async item=>{
    const response=await api('/api/tickets/status',{method:'POST',body:{id:item.id||'',secret:item.secret}});
    if (!item.id && response.reservation.id) putLocalTicket(localStorage,{id:response.reservation.id,secret:item.secret,createdAt:item.createdAt});
    return {...response,localSecret:item.secret};
  }));
  ownedTickets=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
  lastReservations=ownedTickets;
  renderReservationList(ownedTickets);
  const failures=results.filter(x=>x.status==='rejected');
  if (failures.length) status.textContent += ' · '+tr('ticketUnverified',{count:failures.length});
}
function jumpToLookup(event) {
  event?.preventDefault();
  $('myReservations').scrollIntoView({behavior:'smooth',block:'center'});
  loadMyTickets().catch(error=>{$('lookupStatus').textContent=errorText(error);});
}
function closeTicket() {
  if (ticketBusy) return;
  clearTimeout(successTimer);successTimer=null;
  $('ticketOverlay').classList.add('hidden');$('ticketOverlay').setAttribute('aria-hidden','true');
  activeTicket=null;
  loadMyTickets().catch(()=>{});
}
function updateTicketModalText() {
  if (!activeTicket) return;
  const r=activeTicket.reservation;
  $('ticketOverlayTitle').textContent=tr('ticketSlideTitle');
  $('ticketCode').textContent=r.id;
  $('ticketDetails').textContent=`Plant ${r.plant} · ${reservationMeal(r,state?.settings.meals||[],lang)}`;
  $('ticketSlideHint').textContent=tr(slideDirection===1?'slideRight':'slideLeft');
  $('ticketSlide').setAttribute('aria-label',$('ticketSlideHint').textContent);
}
function randomSlideDirection() {
  const byte=new Uint8Array(1);crypto.getRandomValues(byte);return byte[0]%2?1:-1;
}
async function openTicket(info) {
  if (info.eligibility!=='open') return;
  activeTicket=info;slideDirection=randomSlideDirection();swipeProgress=0;
  $('ticketOverlay').classList.remove('hidden');$('ticketOverlay').setAttribute('aria-hidden','false');
  $('ticketScreen').style.background='';$('ticketSlide').classList.remove('hidden');$('ticketVisual').classList.add('hidden');
  $('ticketOverlayStatus').textContent=tr('ticketSwipeNote');$('ticketMainIcon').textContent='🎟️';
  $('ticketClose').classList.remove('hidden');
  const knob=$('ticketSlideKnob');knob.style.transform='';knob.textContent=slideDirection===1?'❯❯':'❮❮';
  $('ticketSlide').classList.toggle('reverse',slideDirection===-1);
  updateTicketModalText();
}
function updateSwipe(percent) {
  swipeProgress=Math.max(0,Math.min(100,percent));
  $('ticketSlide').setAttribute('aria-valuenow',String(Math.round(swipeProgress)));
  const track=$('ticketSlide');
  const span=Math.max(0,track.clientWidth-$('ticketSlideKnob').clientWidth-12);
  $('ticketSlideKnob').style.transform=`translateX(${slideDirection*span*swipeProgress/100}px)`;
}
function onSwipeEnd() {
  if (!swipeActive) return;swipeActive=false;
  if (swipeProgress>=85) { updateSwipe(100);claimTicket(); }
  else updateSwipe(0);
}
async function claimTicket() {
  if (!activeTicket || ticketBusy) return;
  ticketBusy=true;$('ticketSlide').classList.add('hidden');$('ticketClose').classList.add('hidden');
  $('ticketOverlayStatus').textContent=tr('ticketRedeeming');
  const {reservation,localSecret}=activeTicket;
  const bytes=new Uint8Array(20);crypto.getRandomValues(bytes);
  const requestId=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
  try {
    // Re-read the up-to-date ticket state before writing.
    const fresh=await api('/api/tickets/status',{method:'POST',body:{id:reservation.id,secret:localSecret}});
    if (fresh.eligibility!=='open') throw new Error(tr(availabilityText(fresh.eligibility)));
    const result=await api('/api/tickets/claim',{method:'POST',body:{id:reservation.id,secret:localSecret,requestId}});
    showClaimSuccess(result);
  } catch(error) {
    let reconciled=false;
    try {
      const last=await api('/api/tickets/status',{method:'POST',body:{id:reservation.id,secret:localSecret}});
      if (last.reservation.redeemStatus==='used') {
        $('ticketOverlayStatus').textContent=tr('ticketUnknownUsed');reconciled=true;
      }
    } catch { /* status unknown */ }
    if (!reconciled) $('ticketOverlayStatus').textContent=tr('ticketUnknown')+' '+errorText(error);
    $('ticketClose').classList.remove('hidden');
  } finally {ticketBusy=false;}
}
function showClaimSuccess(result) {
  const overlay=$('ticketScreen'), marker=result.marker||visualMarker();
  overlay.style.background=marker.color;
  $('ticketMainIcon').textContent='✅';$('ticketOverlayTitle').textContent=tr('ticketSuccess');
  $('ticketCode').textContent=result.id;
  $('ticketSlide').classList.add('hidden');$('ticketVisual').classList.remove('hidden');
  $('ticketSymbol').textContent=`${marker.symbol} ${marker.number}`;
  $('ticketOverlayStatus').textContent=tr('ticketSuccessNote');
  const startAt=Date.now();
  const endAt=startAt+CLAIM_DURATION_MS;
  const baseline=Date.parse(result.confirmedAt || result.redeemedAt)||Date.now(),localAt=Date.now();
  function tick() {
    if (!activeTicket) return;
    $('ticketSeconds').textContent=new Date(baseline+Date.now()-localAt).toLocaleTimeString('en-GB',{hour12:false,timeZone:state?.settings?.timeZone||'America/Monterrey'});
    const tones=[marker.color,'#245eac','#794cb2','#17684f'];
    overlay.style.background=tones[Math.floor((Date.now()-startAt)/1700)%tones.length];
    const remaining=Math.max(0,Math.ceil((endAt-Date.now())/1000));
    $('ticketCountdown').textContent=tr('ticketSecondsLeft',{count:remaining});
    if (remaining>0) {successTimer=setTimeout(tick,250);return;}
    overlay.style.background='#46544e';$('ticketVisual').classList.add('hidden');$('ticketMainIcon').textContent='🔒';
    $('ticketOverlayTitle').textContent=tr('ticketUsed');$('ticketOverlayStatus').textContent=tr('ticketNoReplay');
    $('ticketClose').classList.remove('hidden');
    loadMyTickets().catch(()=>{});
  }
  tick();
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
  $('ticketRefresh').addEventListener('click',()=>loadMyTickets().catch(err=>alertArea(errorText(err))));
  $('ticketClose').onclick=closeTicket;
  const slider=$('ticketSlide');
  slider.addEventListener('pointerdown',e=>{if(!activeTicket||ticketBusy)return;swipeActive=true;swipeStart=e.clientX;slider.setPointerCapture(e.pointerId);});
  slider.addEventListener('pointermove',e=>{if(!swipeActive)return;const dx=(e.clientX-swipeStart)*slideDirection;updateSwipe(dx/Math.max(1,slider.clientWidth-60)*100);});
  slider.addEventListener('pointerup',onSwipeEnd);slider.addEventListener('pointercancel',()=>{swipeActive=false;updateSwipe(0)});
  slider.addEventListener('keydown',e=>{if(e.key===(slideDirection===1?'ArrowRight':'ArrowLeft')){e.preventDefault();updateSwipe(swipeProgress+25);if(swipeProgress>=85)claimTicket();}});
  $('closeModal').onclick = closeReserve; $('cancelBtn').onclick = closeReserve;
  $('confirmBtn').onclick = submitReservation;
  $('reserveModal').addEventListener('click', ev => { if (ev.target === $('reserveModal')) closeReserve(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeReserve(); });
  applyLanguage();
  await acceptTransferFromFragment(localStorage);
  loadMyTickets().catch(()=>{});
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
