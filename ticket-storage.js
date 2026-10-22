import { createSecret, hashSecret, ticketListLoad, putLocalTicket, ticketIdValid } from './ticket-schema.js';
export { ticketListLoad, createSecret, hashSecret, putLocalTicket } from './ticket-schema.js';
export async function newTicketIdentity() {const secret=createSecret();return {secret,credentialHash:await hashSecret(secret)};}
export async function acceptTransferFromFragment(storage=localStorage,verify=async()=>{}) {
  // Fragments are not sent in HTTP requests. They remain shareable bearer secrets.
  if (!location.hash.startsWith('#ticket=')) return false;
  const raw=decodeURIComponent(location.hash.slice(8));
  history.replaceState(null,'',location.pathname+location.search);
  const [id,secret]=raw.split('.');
  if (!ticketIdValid(id) || !/^[0-9a-f]{64}$/.test(secret)) return false;
  await verify({id,secret});
  putLocalTicket(storage,{id,secret});return true;
}
export function transferLink(id, secret) {
  const url=new URL('./index.html',location.href); url.hash='ticket='+encodeURIComponent(`${id}.${secret}`);return url.href;
}

/** An administrator-reset enrollment link, not a meal ticket. */
export function resetDeviceLink(employeeId,secret) {
  if (!/^\d{1,24}$/.test(String(employeeId)) || !/^[0-9a-f]{64}$/.test(String(secret))) throw new Error('设备重置参数无效');
  const url=new URL('./index.html',location.href);
  url.hash='device='+encodeURIComponent(`${employeeId}.${secret}`);
  return url.href;
}
export async function acceptDeviceResetFromFragment(verify) {
  if (!location.hash.startsWith('#device=')) return false;
  const raw=decodeURIComponent(location.hash.slice(8));
  history.replaceState(null,'',location.pathname+location.search);
  const [employeeId,secret]=raw.split('.');
  if (!/^\d{1,24}$/.test(employeeId)||!/^[0-9a-f]{64}$/.test(secret)) throw new Error('设备重置链接格式无效');
  await verify({employeeId,secret});
  return true;
}
