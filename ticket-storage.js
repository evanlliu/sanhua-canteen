import { createSecret, hashSecret, ticketListLoad, putLocalTicket, ticketIdValid } from './ticket-schema.js';
export { ticketListLoad, createSecret, hashSecret, putLocalTicket } from './ticket-schema.js';
export async function newTicketIdentity() {const secret=createSecret();return {secret,credentialHash:await hashSecret(secret)};}
export async function acceptTransferFromFragment(storage=localStorage) {
  // Fragments are not sent in HTTP requests. They remain shareable bearer secrets.
  if (!location.hash.startsWith('#ticket=')) return false;
  const raw=decodeURIComponent(location.hash.slice(8));
  history.replaceState(null,'',location.pathname+location.search);
  const [id,secret]=raw.split('.');
  if (!ticketIdValid(id) || !/^[0-9a-f]{64}$/.test(secret)) return false;
  putLocalTicket(storage,{id,secret});return true;
}
export function transferLink(id, secret) {
  const url=new URL('./index.html',location.href); url.hash='ticket='+encodeURIComponent(`${id}.${secret}`);return url.href;
}
