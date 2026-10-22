import assert from 'node:assert/strict';
import { beginTicketTear, endTicketTear, awaitTearAndClaim } from '../ticket-tear-animation.js';

let count = 0;
function check(expression, explanation) {
  assert.ok(expression, explanation);
  count++;
  console.log('✓', explanation);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function classes() {
  const items = new Set();
  return {
    add(...values) { values.forEach(v => items.add(v)); },
    remove(...values) { values.forEach(v => items.delete(v)); },
    contains(value) { return items.has(value); },
  };
}
function element() {
  const handlers = new Map();
  return {
    classList: classes(), textContent: '', attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, listener) { handlers.set(type, listener); },
    removeEventListener(type, listener) { if (handlers.get(type) === listener) handlers.delete(type); },
    fire(type) { handlers.get(type)?.({target:this}); }
  };
}
const ids = [
  'ticketTear','ticketScreen','ticketTearUpper','ticketTearNumberLabel',
  'ticketTearCode','ticketTearNameLabel','ticketTearName','ticketTearIdLabel',
  'ticketTearId','ticketTearPlant','ticketTearMeal'
];
const nodes = Object.fromEntries(ids.map(x => [x, element()]));
globalThis.document = {getElementById: id => nodes[id]};
let frames = [];
globalThis.requestAnimationFrame = cb => {frames.push(cb);};
globalThis.window = {matchMedia: () => ({matches:false})};
const reservation={id:'261021-D-0001', employeeName:'DEMO STAFF', employeeId:'0008', plant:'D'};
const opts={meal:'Lunch',labels:{reservationNumber:'Reservation',name:'Name',staffNumber:'Employee ID'}};

let animation = beginTicketTear(reservation, opts);
check(nodes.ticketTear.classList.contains('hidden')===false, 'tear pieces visible on begin');
check(nodes.ticketScreen.classList.contains('is-tearing'), 'original ticket identity hidden while tearing');
check(nodes.ticketTearCode.textContent===reservation.id && nodes.ticketTearName.textContent===reservation.employeeName, 'tear displays reservation and employee name');
check(nodes.ticketTearId.textContent===reservation.employeeId && nodes.ticketTearMeal.textContent==='Lunch', 'tear displays employee ID and meal');
frames.shift()();
check(nodes.ticketTear.classList.contains('is-animating'), 'animation starts after browser frame');
let server=deferred();
let completed=false;
const coupled = awaitTearAndClaim(animation, server.promise).then(x => {completed=true;return x;});
server.resolve({status:'used'});
await Promise.resolve();await Promise.resolve();
check(!completed, 'fast successful server reply must wait for animation');
nodes.ticketTearUpper.fire('animationend');
check((await coupled).status==='used', 'server success released only after animation');
check(nodes.ticketTear.classList.contains('is-separated'), 'paper remains separated at end while awaiting UI decision');
endTicketTear();
check(nodes.ticketTear.classList.contains('hidden') && !nodes.ticketScreen.classList.contains('is-tearing'), 'teardown restores normal display');

animation=beginTicketTear(reservation,opts);
frames.shift()();
server=deferred();
let resultSettled=false;
const delayed=awaitTearAndClaim(animation, server.promise).then(() => {resultSettled=true;});
nodes.ticketTearUpper.fire('animationend');
await Promise.resolve();
check(!resultSettled && nodes.ticketTear.classList.contains('is-separated'), 'slow server response keeps paper separated and pending');
server.resolve({status:'used'});
await delayed;
check(resultSettled, 'late server response releases joint gate');
endTicketTear();

animation=beginTicketTear(reservation,opts);
frames.shift()();
server=deferred();
const failed=awaitTearAndClaim(animation,server.promise).then(()=>'unexpected',()=>'rejected');
server.reject(new Error('network failed'));
nodes.ticketTearUpper.fire('animationend');
check((await failed)==='rejected', 'network failure does not resolve as claim success');
endTicketTear();

window.matchMedia=() => ({matches:true});
animation=beginTicketTear(reservation,opts);
await animation;
check(nodes.ticketTear.classList.contains('is-separated'), 'reduced-motion instantly shows separated paper');
endTicketTear();

animation=beginTicketTear(reservation,opts);
await animation;
endTicketTear();
check(nodes.ticketTear.classList.contains('hidden'), 'reduced-motion teardown works');

// Full claim/API and already-used protection are covered by e-ticket-v14.test.mjs.
console.log(`PASS ${count} V14.5 tear animation tests`);
