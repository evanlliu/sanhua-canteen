import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {githubApi} from '../github-store.js';
import {hashSecret,createSecret} from '../ticket-schema.js';
import {loadBrowserBinding,hashBrowserId,pinBrowserEmployee,localEmployeeCheck,deviceTicketAllowed,DEVICE_ERRORS} from '../device-binding.js';
import {translate} from '../i18n.js';
globalThis.crypto??=webcrypto;
const cases=[];
async function test(name,fn) {await fn();cases.push(name);console.log(`✓ ${name}`);}
const items=new Map(); const storage={getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v)};
let identity=loadBrowserBinding(storage); const oldId=identity.id;
await test('Browser stores one random persistent id',async()=>{assert.match(oldId,/^[0-9a-f]{64}$/);assert.equal(loadBrowserBinding(storage).id,oldId)});
const dev1=await hashBrowserId(identity.id),dev2='2'.repeat(64),dev3='3'.repeat(64);
await test('Only digest sent to server, not original browser id',async()=>{assert.notEqual(dev1,oldId);assert.match(dev1,/^[0-9a-f]{64}$/)});
await test('First successful booking pins local browser',async()=>{pinBrowserEmployee(storage,'8');assert.equal(loadBrowserBinding(storage).employeeId,'8')});
await test('Local browser rejects other employee',async()=>{assert.throws(()=>pinBrowserEmployee(storage,'14'),/DEVICE_BOUND_TO_OTHER_EMPLOYEE/);assert.equal(localEmployeeCheck(loadBrowserBinding(storage),'14',[]),DEVICE_ERRORS.BROWSER)});
await test('Legacy two-person browser blocked before any booking',async()=>{assert.equal(localEmployeeCheck({id:oldId,employeeId:''},'8',['8','14']),DEVICE_ERRORS.MIXED)});
await test('Legacy ticket status network uncertainty blocked',async()=>{assert.equal(localEmployeeCheck({id:oldId,employeeId:''},'8',['8'],true),DEVICE_ERRORS.MIXED)});
const key='isolated-v146-token-material';
const aes=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)),{name:'AES-GCM'},false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const cy=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode('FAKE-TEST-KEY'));
globalThis.window={APP_CONFIG:{github:{owner:'testing',repo:'no-real-repo',branch:'data',path:'data.json',tokenCiphertext:Buffer.concat([Buffer.from(iv),Buffer.from(cy)]).toString('base64'),keyMaterial:key}}};
const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Monterrey',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const date=`${parts.year}-${parts.month}-${parts.day}`;
let data={settings:{timeZone:'America/Monterrey',eTicketEnabled:true,meals:[{id:'lunch',label:'Lunch',start:'00:00',end:'23:59',enabled:true}]},employees:[{employeeId:'8',name:'FAKE A'},{employeeId:'14',name:'FAKE B'}],reservations:[]};
let sha=0,conflicts=0;
globalThis.fetch=async (url,opts={})=>{
  if ((opts.method||'GET')==='GET') return new Response(JSON.stringify({sha:String(sha),type:'file',content:Buffer.from(JSON.stringify(data)).toString('base64')}),{status:200});
  if(conflicts){conflicts--;sha++;return new Response(JSON.stringify({message:'sha mismatch'}),{status:409});}
  const b=JSON.parse(opts.body);
  if(b.sha!==String(sha)) return new Response(JSON.stringify({message:'sha mismatch'}),{status:409});
  data=JSON.parse(Buffer.from(b.content,'base64').toString('utf8'));sha++;
  return new Response(JSON.stringify({commit:{committer:{date:new Date().toISOString()}}}),{status:200});
};
const secret1=createSecret(),digest1=await hashSecret(secret1),secret2=createSecret(),digest2=await hashSecret(secret2);
const book=(employeeId,deviceHash,hash,plant='D')=>githubApi('/api/reservations',{method:'POST',body:{employeeId,mealId:'lunch',date,plant,credentialHash:hash,deviceHash}});
let first;
await test('GitHub writes binding and reservation atomically',async()=>{first=await book('8',dev1,digest1);assert.equal(data.deviceBindings['8'],dev1);assert.equal(first.reservation.deviceBound,true)});
await test('Same device cannot book for employee 14',async()=>{await assert.rejects(book('14',dev1,digest2),/DEVICE_BOUND_TO_OTHER_EMPLOYEE/);assert.equal(data.reservations.length,1)});
await test('Same employee cannot book on another browser',async()=>{await assert.rejects(book('8',dev2,digest2),/EMPLOYEE_BOUND_TO_OTHER_DEVICE/)});
await test('Unaffiliated device cannot read valid ticket as redeemable',async()=>{const response=await githubApi('/api/tickets/status',{method:'POST',body:{id:first.reservation.id,secret:secret1,deviceHash:dev2}});assert.equal(response.eligibility,'device')});
await test('Unaffiliated device cannot redeem a stolen ticket',async()=>{await assert.rejects(githubApi('/api/tickets/claim',{method:'POST',body:{id:first.reservation.id,secret:secret1,requestId:'a'.repeat(40),deviceHash:dev2}}),/设备绑定不匹配/)});
await test('SHA conflicts still retry with binding enforced',async()=>{conflicts=1;await book('14',dev2,digest2,'B');assert.equal(data.deviceBindings['14'],dev2);assert.equal(data.reservations.length,2)});
await test('Admin reissue suspends all outstanding old tickets',async()=>{
  const fresh=createSecret(),digest=await hashSecret(fresh);
  await githubApi('/api/admin/tickets/reissue',{method:'POST',body:{id:first.reservation.id,credentialHash:digest}});
  assert.equal(data.deviceBindings['8'],'pending');assert.equal(data.reservations[0].deviceTransferPending,true);
  await assert.rejects(githubApi('/api/tickets/claim',{method:'POST',body:{id:first.reservation.id,secret:fresh,requestId:'b'.repeat(40),deviceHash:dev1}}),/设备绑定不匹配/);
  globalThis.newSecret=fresh;
});
await test('Old reissued secret is invalid',async()=>{await assert.rejects(githubApi('/api/tickets/status',{method:'POST',body:{id:first.reservation.id,secret:secret1,deviceHash:dev1}}),/无效/)});
await test('Transfer does not activate with wrong bearer',async()=>{await assert.rejects(githubApi('/api/devices/activate',{method:'POST',body:{id:first.reservation.id,secret:secret1,deviceHash:dev3}}),/DEVICE_TRANSFER_REQUIRES_ADMIN/)});
await test('Admin-issued link activates only one new browser',async()=>{
  const answer=await githubApi('/api/devices/activate',{method:'POST',body:{id:first.reservation.id,secret:newSecret,deviceHash:dev3}});
  assert.equal(answer.employeeId,'8');assert.equal(data.deviceBindings['8'],dev3);assert.equal(data.reservations[0].deviceTransferPending,false);
});
await test('Replaying activation link cannot steal binding',async()=>{await assert.rejects(githubApi('/api/devices/activate',{method:'POST',body:{id:first.reservation.id,secret:newSecret,deviceHash:dev1}}),/DEVICE_TRANSFER_REQUIRES_ADMIN/)});
await test('New browser can redeem while old browser cannot',async()=>{
  const fresh=await githubApi('/api/tickets/status',{method:'POST',body:{id:first.reservation.id,secret:newSecret,deviceHash:dev3}});assert.equal(fresh.eligibility,'open');
  const stale=await githubApi('/api/tickets/status',{method:'POST',body:{id:first.reservation.id,secret:newSecret,deviceHash:dev1}});assert.equal(stale.eligibility,'device');
});
await test('Admin reset never restores any consumed ticket',async()=>{
  await githubApi('/api/tickets/claim',{method:'POST',body:{id:first.reservation.id,secret:newSecret,requestId:'c'.repeat(40),deviceHash:dev3}});
  globalThis.resetSecret=createSecret();
  await githubApi('/api/admin/devices/reset',{method:'POST',body:{employeeId:'8',resetHash:await hashSecret(resetSecret)}});
  assert.equal(data.deviceBindings['8'],'pending');assert.equal(data.reservations[0].redeemStatus,'used');
  await assert.rejects(githubApi('/api/tickets/claim',{method:'POST',body:{id:first.reservation.id,secret:newSecret,requestId:'d'.repeat(40),deviceHash:dev3}}),/已经使用/);
});
await test('Reset link is required before any device can rebind',async()=>{
  await assert.rejects(book('8',dev1,digest1),/EMPLOYEE_BOUND_TO_OTHER_DEVICE/);
  await assert.rejects(githubApi('/api/devices/activate-reset',{method:'POST',body:{employeeId:'8',secret:createSecret(),deviceHash:'4'.repeat(64)}}),/DEVICE_TRANSFER_REQUIRES_ADMIN/);
  assert.equal(data.deviceBindings['8'],'pending');
});
await test('Reset one-time link activates a new browser and cannot replay',async()=>{
  const result=await githubApi('/api/devices/activate-reset',{method:'POST',body:{employeeId:'8',secret:resetSecret,deviceHash:'4'.repeat(64)}});
  assert.equal(result.activated,true);assert.equal(data.deviceBindings['8'],'4'.repeat(64));
  await assert.rejects(githubApi('/api/devices/activate-reset',{method:'POST',body:{employeeId:'8',secret:resetSecret,deviceHash:dev1}}),/DEVICE_TRANSFER_REQUIRES_ADMIN/);
});
await test('Reset preserves old meal booking restrictions',async()=>{
  await assert.rejects(book('8','4'.repeat(64),digest1),/已预约/);
});
await test('Binding survives removal of reservation records',async()=>{
  await githubApi('/api/admin/reservations/'+encodeURIComponent(data.reservations[1].id),{method:'DELETE'});
  assert.equal(data.deviceBindings['14'],dev2);
  await assert.rejects(book('14',dev3,await hashSecret(createSecret()),'B'),/EMPLOYEE_BOUND_TO_OTHER_DEVICE/);
});
await test('Legacy unbound ticket is readable without altering saved data',async()=>{
  const mock={deviceBindings:{},reservations:[]};
  assert.equal(deviceTicketAllowed(mock,{employeeId:'999',credentialHash:'x'},''),true);
});
await test('All 3 UI languages have binding prompts',async()=>{
  for(const lang of ['zh','en','es']) for(const key of ['deviceBoundOther','employeeBoundOther','deviceMixedHistory','deviceTransferRejected','ticketDevice']) assert.notEqual(translate(lang,key),key);
});

await test('Device enrollment URL contains one-time secret in fragment only',async()=>{
  const {resetDeviceLink}=await import('../ticket-storage.js');
  const originalLocation=globalThis.location;
  globalThis.location={href:'https://example.invalid/sanhua-canteen/admin.html'};
  const link=resetDeviceLink('8',resetSecret);
  assert.match(link,/\/index\.html#device=8\.[0-9a-f]{64}$/);
  globalThis.location=originalLocation;
});
await test('Device reset fragment must pass verification before local activation',async()=>{
  const {acceptDeviceResetFromFragment}=await import('../ticket-storage.js');
  const oldLocation=globalThis.location,oldHistory=globalThis.history;
  let replaced='';globalThis.location={hash:'#device=8.'+resetSecret,pathname:'/index.html',search:''};
  globalThis.history={replaceState:(a,b,c)=>{replaced=c;}};
  let passed=false;
  const accepted=await acceptDeviceResetFromFragment(async(item)=>{assert.equal(item.employeeId,'8');assert.equal(item.secret,resetSecret);passed=true;});
  assert.equal(accepted,true);assert.equal(passed,true);assert.equal(replaced,'/index.html');
  globalThis.location=oldLocation;globalThis.history=oldHistory;
});
await test('Ticket transfer callback rejects a wrong browser before saving',async()=>{
  const {acceptTransferFromFragment}=await import('../ticket-storage.js');
  const oldLocation=globalThis.location,oldHistory=globalThis.history;
  globalThis.location={hash:'#ticket='+first.reservation.id+'.'+newSecret,pathname:'/index.html',search:''};
  globalThis.history={replaceState:()=>{}};
  const hold=new Map(),sampleStorage={getItem:k=>hold.get(k)||null,setItem:(k,v)=>hold.set(k,v)};
  await assert.rejects(acceptTransferFromFragment(sampleStorage,async()=>{throw new Error(DEVICE_ERRORS.BROWSER)}),/DEVICE_BOUND_TO_OTHER_EMPLOYEE/);
  assert.equal(hold.size,0);
  globalThis.location=oldLocation;globalThis.history=oldHistory;
});
console.log(`PASS: ${cases.length} V14.6 device binding tests (isolated fake data)`);
