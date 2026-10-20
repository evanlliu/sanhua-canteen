import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { canBookMeal } from '../meal-schema.js';
import { githubApi } from '../github-store.js';

// Run deterministic boundary tests at 2026-01-20 America/Monterrey (UTC-6).
const RealDate = Date;
let fakeUtc = RealDate.parse('2026-01-20T14:00:00Z'); // local 08:00
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeUtc])); }
  static now() { return fakeUtc; }
}
globalThis.Date = FakeDate;
globalThis.crypto ??= webcrypto;
globalThis.btoa ??= s => Buffer.from(s, 'binary').toString('base64');
globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const local = time => { fakeUtc = RealDate.parse('2026-01-20T06:00:00Z') + Number(time.slice(0,2))*3600000 + Number(time.slice(3))*60000; };
const date = '2026-01-20';
let passed = 0, writes = 0, sha = 1;
const test = async (label, func) => { await func(); console.log(`✓ ${++passed} ${label}`); };
const encrypted = async token => {
 const secret = 'test-key-local-only';
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
 const key = await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt']);
 const iv = crypto.getRandomValues(new Uint8Array(12));
 const cy = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(token)));
 return { ciphertext: Buffer.concat([Buffer.from(iv),Buffer.from(cy)]).toString('base64'), secret };
};
const { ciphertext, secret } = await encrypted('fake-test-token');
globalThis.window = { APP_CONFIG:{github:{owner:'test',repo:'sanhua-canteen',branch:'data',path:'data.json',tokenCiphertext:ciphertext,keyMaterial:secret}}};
let db = {settings:{timeZone:'America/Monterrey', maxAdvanceDays:0,meals:[
 {id:'breakfast',nameZh:'早餐',start:'07:00',end:'09:00',enabled:false},
 {id:'lunch',nameZh:'午餐',start:'11:30',end:'14:00',enabled:true},
 {id:'dinner',nameZh:'点心',start:'17:30',end:'20:00',enabled:true},
]},employees:[{employeeId:'8',name:'一位工号'},{employeeId:'14',name:'两位工号'},{employeeId:'008',name:'前导零工号'}],reservations:[]};
const response=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});
globalThis.fetch=async(raw,opts={})=>{
 const u=new URL(raw),method=opts.method||'GET';
 assert.equal(u.pathname, '/repos/test/sanhua-canteen/contents/data.json');
 if(method==='GET')return response(200,{sha:String(sha),type:'file',content:Buffer.from(JSON.stringify(db)).toString('base64')});
 if(method==='PUT'){
   assert.equal(opts.headers.Authorization,'Bearer fake-test-token');
   const body=JSON.parse(opts.body);assert.equal(body.branch,'data');assert.equal(body.sha,String(sha));
   db=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));
   sha++;writes++;return response(200,{content:{sha:String(sha)}});
 }
 throw Error(`Bad method ${method}`);
};
const reserve=(id,meal)=>githubApi('/api/reservations',{method:'POST',body:{employeeId:id,mealId:meal,date,plant:'D'}});
const reject=(id,meal,reason)=>assert.rejects(reserve(id,meal),reason);
await test('08:00 上午午餐和晚点心都不应显示为可预约',()=>{
 local('08:00');const meals=db.settings.meals.filter(m=>canBookMeal(m,date,date,'08:00'));
 assert.equal(meals.length,0);
});
await test('08:00 接口直接提交午餐必须拒绝',async()=>{await reject('8','lunch',/尚未到/);assert.equal(writes,0)});
await test('08:00 接口直接提交点心必须拒绝',async()=>{await reject('8','dinner',/尚未到/);assert.equal(writes,0)});
await test('开始前 1 分钟仍拒绝午餐',async()=>{local('11:29');await reject('8','lunch',/尚未到/)});
await test('11:30 开始立即允许午餐',async()=>{local('11:30');const r=await reserve('8','lunch'); assert.equal(r.reservation.employeeId,'8');});
await test('11:30 允许两位工号午餐',async()=>{const r=await reserve('14','lunch');assert.equal(r.reservation.employeeId,'14');});
await test('11:30 允许前导零工号并与8区分',async()=>{const r=await reserve('008','lunch');assert.equal(r.reservation.employeeId,'008');});
await test('同员工同餐次仍禁止重复预约',async()=>{await reject('8','lunch',/不能重复预约/)});
await test('13:59 午餐仍然开放',()=>{local('13:59');assert.equal(canBookMeal(db.settings.meals[1],date,date,'13:59'),true);});
await test('14:00 午餐结束，接口不允许',async()=>{local('14:00');await reject('8','lunch',/已结束/)});
await test('17:29 点心未开始，接口不允许',async()=>{local('17:29');await reject('8','dinner',/尚未到/)});
await test('17:30 点心开放，可以和当天午餐分别预约',async()=>{local('17:30');const r=await reserve('8','dinner');assert.equal(r.reservation.mealId,'dinner');});
await test('19:59 点心仍然开放',()=>{local('19:59');assert.equal(canBookMeal(db.settings.meals[2],date,date,'19:59'),true);});
await test('20:00 点心结束，不可预约',async()=>{local('20:00');await reject('14','dinner',/已结束/)});
await test('已禁用早餐不显示，也无法提交',async()=>{local('08:00');assert.equal(canBookMeal(db.settings.meals[0],date,date,'08:00'),false);await reject('8','breakfast',/暂未开放/)});
await test('不允许用修改过的预约日期绕过今天限制',async()=>{local('11:30');await assert.rejects(githubApi('/api/reservations',{method:'POST',body:{employeeId:'8',mealId:'lunch',date:'2026-01-21',plant:'D'}}),/仅允许预约当天/)});
await test('GitHub read-only 配置和已有预约查询仍然有效',async()=>{const c=await githubApi('/api/config');assert.equal(c.settings.meals.length,3);const list=await githubApi('/api/reservations/my?employeeId=8');assert.equal(list.reservations.length,2);});
await test('展示字段固定 yyyy-MM-dd HH:mm，保留独立 date 提交字段',()=>{const staff=readFileSync(new URL('../staff.js',import.meta.url),'utf8');const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(staff,/`\$\{clock\.today\} \$\{clock\.nowTime\}`/);assert.match(staff,/date: dateInput\.dataset\.date/);assert.match(html,/data-i18n="mealDate">用餐时间（当天）/);assert.match(html,/id="mealDate"[^>]*readonly/);});
await test('中文/英文/墨西哥西语字段完整',async()=>{const {translate}=await import('../i18n.js');assert.equal(translate('zh','mealDate'),'用餐时间（当天）');assert.equal(translate('en','mealDate'),'Meal time (today)');assert.equal(translate('es','mealDate'),'Horario de comida (hoy)');});

// Demo mode uses the same booking window; emulate browser storage without real network.
const saved = new Map();globalThis.location={search:'?demo=1',origin:'https://demo.test'};
globalThis.localStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
const {api,localClock}=await import('../client-api.js');
await test('演示模式上午8点也拒绝提交晚餐',async()=>{local('08:00');const c=await api('/api/config');assert.equal(c.today,date);assert.equal(c.nowTime,'08:00');await assert.rejects(api('/api/reservations',{method:'POST',body:{employeeId:'1000000001',date,mealId:'dinner',plant:'D'}}),/尚未到/);});
await test('演示模式在午餐时段可提交午餐',async()=>{local('11:30');const r=await api('/api/reservations',{method:'POST',body:{employeeId:'1000000001',date,mealId:'lunch',plant:'D'}});assert.equal(r.reservation.mealId,'lunch')});
await test('演示模式在午餐结束后拒绝再次提交',async()=>{local('14:00');await assert.rejects(api('/api/reservations',{method:'POST',body:{employeeId:'1000000001',date,mealId:'lunch',plant:'D'}}),/已结束/) });
await test('演示模式使用日期 Plant 流水号，删除后不复用',async()=>{
  local('11:31');
  const lookup=await api('/api/reservations/my?employeeId=1000000001');
  const first=lookup.reservations.find(r=>r.mealId==='lunch');
  const yy=date.slice(2,4)+date.slice(5,7)+date.slice(8,10);
  assert.equal(first.id,`${yy}-D-0001`);
  await api('/api/admin/reservations/'+first.id,{method:'DELETE',adminKey:'demo'});
  const second=await api('/api/reservations',{method:'POST',body:{employeeId:'1000000001',date,mealId:'lunch',plant:'D'}});
  assert.equal(second.reservation.id,`${yy}-D-0002`);
});
console.log(`PASS: ${passed} V13 time-window tests`);
