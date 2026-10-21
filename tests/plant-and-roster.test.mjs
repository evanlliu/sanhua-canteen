import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
let tests=0;function ok(value,label){assert.ok(value,label); tests++; console.log('✓',label)}
globalThis.window={APP_CONFIG:{github:{owner:'test',repo:'canteen',branch:'data',path:'data.json',keyMaterial:'demo-key',tokenCiphertext:''}}};
const material=window.APP_CONFIG.github.keyMaterial;
const digest=await crypto.webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
const key=await crypto.webcrypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt']);
const iv=crypto.randomBytes(12);
const encrypted=await crypto.webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('fake-token'));
window.APP_CONFIG.github.tokenCiphertext=Buffer.concat([iv,Buffer.from(encrypted)]).toString('base64');
globalThis.location={search:'',origin:'https://demo.local'};
const {githubApi}=await import(root+'/github-store.js');
const {validPlant,reservationCode,validReservationCode,nextReservationCode}=await import(root+'/plant-schema.js');
const {localClock}=await import(root+'/client-api.js');
const [date,time]=Object.values(localClock('America/Monterrey'));
let db={settings:{timeZone:'America/Monterrey',maxAdvanceDays:0,meals:[{id:'lunch',label:'午餐',start:'00:00',end:'23:59',enabled:true}]},employees:[{employeeId:'8',name:'demo old'}],reservations:[]};
let sha='mock1', writes=0, lastPayloadLength=0, conflictHook=null;
globalThis.fetch=async (url,opt={})=>{
  if ((opt.method||'GET')==='GET') return new Response(JSON.stringify({sha,type:'file',content:Buffer.from(JSON.stringify(db)).toString('base64')}),{status:200});
  const b=JSON.parse(opt.body);
  if (conflictHook) { const hook=conflictHook; conflictHook=null; hook(); return new Response(JSON.stringify({message:'sha conflict'}),{status:409}); }
  if (b.sha!==sha)return new Response(JSON.stringify({message:'sha conflict'}),{status:409});
  lastPayloadLength=Buffer.from(b.content,'base64').length;db=JSON.parse(Buffer.from(b.content,'base64').toString());writes++;sha='mock'+(writes+1);
  return new Response(JSON.stringify({sha}),{status:200});
};
const fields=['ID','Name ','NickName','Employee General Type','Clasification of Employee Type','Mex/Chin','Tier 1 Dept.','Tier 2 Dept.','Tier 3 Dept.','Department to Labor Cost','CC Code','CC System Description','Job Grade','Union Team','Hiring Date','职位名称-EN\nPostion Name-EN','职位名称-Es\nPostion Name-Es','职位名称-CN\nPostion Name-CN','CN Postion + English'];
let entries=[];
for(let i=0;i<1441;i++){
 let id=String(i+8), name=`FAKE SAMPLE USER ${i+8}`;
 let values=[id,name,`nickname${i}`,'间接工INDL','间接工INDL','MX','一工厂 Plant I','/','生产组二组 Prodution Team II','Plant I','89A681','Plant 1 Mfg-Production','O-//','YES','42849','Production TL','Operador','操作员','操作员 Production TL'];
 entries.push({employeeId:id,name,values});
}
const result=await githubApi('/api/admin/import-roster',{method:'POST',body:{mode:'replace',columns:fields,employees:entries}});
ok(result.total===1441,'1441 employee full-roster import');
ok(db.rosterColumns.length===19 && db.employees[0].values.length===19,'19 original headers + all values retained');
ok(db.rosterColumns[1]==='Name ' && db.rosterColumns[15].includes('\n'),'special and trailing-space header preserved');
ok(lastPayloadLength<900000,`GitHub data.json under 900KB (${lastPayloadLength} bytes)`);
const search=await githubApi('/api/employees/search?q=FAKE SAMPLE USER 8',{method:'GET'});
ok(search.employees.some(e=>e.employeeId==='8'),'name search intact');
ok(validPlant('B') && !validPlant('X'),'plant whitelist');
const staticCode=reservationCode('2026-10-20','B',1);
ok(staticCode==='261020-B-0001','confirmed booking-number format 261020-B-0001');
for(const p of ['D','G','B','H']) {
  ok(reservationCode('2026-10-20',p,42)===`261020-${p}-0042`,`date + Plant ${p} + four-digit sequence`);
}
ok(validReservationCode(staticCode) && validReservationCode('CEBA40FD604-D') && validReservationCode('CEBA40FD604') && !validReservationCode('261020-X-0001'),'legacy codes supported; invalid plant rejected');
const todayPrefix=`${date.slice(2,4)}${date.slice(5,7)}${date.slice(8,10)}`;
const booking=await githubApi('/api/reservations',{method:'POST',body:{employeeId:'8',date,mealId:'lunch',plant:'D',credentialHash:'a'.repeat(64)}});
ok(booking.reservation.plant==='D' && booking.reservation.id===`${todayPrefix}-D-0001`,'book Plant D with first daily sequence');
ok(db.sequenceCounters[`${date}-D`]===1,'sequence high water persisted to data JSON');
let failed=false;try{await githubApi('/api/reservations',{method:'POST',body:{employeeId:'8',date,mealId:'lunch',plant:'H',credentialHash:'b'.repeat(64)}})}catch(e){failed=/已预约/.test(e.message)}
ok(failed,'switching plant cannot bypass one meal one employee limit');
let accessDenied=false;try{await githubApi('/api/reservations/my?employeeId=8',{method:'GET'});}catch(e){accessDenied=e.status===403;}
ok(accessDenied,'unauthenticated employee ID lookup is disabled');
await githubApi('/api/admin/reservations/'+encodeURIComponent(booking.reservation.id),{method:'DELETE'});
ok(db.reservations.length===0,'delete suffixed reservation');
const b2=await githubApi('/api/reservations',{method:'POST',body:{employeeId:'8',date,mealId:'lunch',plant:'G',credentialHash:'c'.repeat(64)}});
ok(b2.reservation.id===`${todayPrefix}-G-0001`,'re-book after delete with another Plant starts independent sequence');
db.reservations.push({...b2.reservation,id:'CCEBA40FD60'}); // legacy record
await githubApi('/api/admin/reservations/CCEBA40FD60',{method:'DELETE'});
ok(db.reservations.length===1,'deleting legacy unsuffixed reservation still works');
// Deleted D record must never cause D-0001 reuse, even if no D reservations survive.
const afterDelete=nextReservationCode(db,date,'D');
ok(afterDelete===`${todayPrefix}-D-0002`,'deleted daily sequence never reused');
const nextG=nextReservationCode(db,date,'G');
ok(nextG===`${todayPrefix}-G-0002`,'each Plant uses independent daily counter');
const tomorrow=new Date(new Date(date+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
const nextDay=nextReservationCode(db,tomorrow,'D');
ok(nextDay===`${tomorrow.slice(2,4)}${tomorrow.slice(5,7)}${tomorrow.slice(8,10)}-D-0001`,'new day starts at 0001');
// Another GitHub writer takes B-0001 just before we PUT. Our SHA retry must allocate B-0002.
conflictHook=()=>{
  db.sequenceCounters[`${date}-B`]=1;
  db.reservations.push({id:`${todayPrefix}-B-0001`, employeeId:'9',employeeName:'external writer',date,plant:'B',mealId:'lunch',mealStart:'00:00',mealEnd:'23:59',createdAt:new Date().toISOString()});
  sha='other-writer-sha';
};
const raced=await githubApi('/api/reservations',{method:'POST',body:{employeeId:'10',date,mealId:'lunch',plant:'B',credentialHash:'d'.repeat(64)}});
ok(raced.reservation.id===`${todayPrefix}-B-0002`,'SHA conflict retry reallocates sequential number without collision');
ok(db.sequenceCounters[`${date}-B`]===2,'SHA retry persists the correct high-water sequence');
const recovered={reservations:[{id:'261020-H-0008'}]};
ok(nextReservationCode(recovered,'2026-10-20','H')==='261020-H-0009','legacy data without counter resumes after max surviving number');
const gap={reservations:[{id:'261020-H-0025'}], sequenceCounters:{'2026-10-20-H':40}};
ok(nextReservationCode(gap,'2026-10-20','H')==='261020-H-0041','persisted high water wins even when some IDs were removed');
assert.throws(()=>reservationCode('2026-10-20','B',10000),/9999/);
assert.throws(()=>nextReservationCode({reservations:[],sequenceCounters:{'2026-10-20-B':9999}},'2026-10-20','B'),/9999/);
ok(true,'daily 9999 cap prevents overflowing 4-digit code');
// Test parsing, fake data only, no real names written.
const adminSrc=fs.readFileSync(root+'/admin.js','utf8');
const start=adminSrc.indexOf('function parseEmployees(rows)');const end=adminSrc.indexOf('async function readFile()',start);
const parser=new Function(adminSrc.slice(start,end)+';return parseEmployees;')();
const parsed=parser([fields,entries[0].values]);
ok(parsed.columns.length===19 && parsed.employees[0].values.length===19,'admin Excel parser maps 19 fields');
ok(parsed.employees[0].employeeId==='8','admin Excel parser accepts single-digit employee ID');
console.log(`ALL ${tests} TESTS PASSED`);
