/** V14 electronic ticket rules. UI-only access control; GitHub Pages is NOT a trusted server. */
export const TICKET_STORAGE_KEY = 'sanhua-canteen-tickets-v14';
export const CLAIM_DURATION_MS = 8000;
export const CLAIM_STATES = Object.freeze({ pending:'pending', used:'used', exception:'exception' });
const ID_RE = /^(?:\d{6}-[DGBH]-\d{4}|C[0-9A-F]{10}-[DGBH])$/;
export function ticketIdValid(id) { return ID_RE.test(String(id||'')); }
export function createSecret() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器不支持安全随机数，请使用 HTTPS 或 localhost。');
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('');
}
export async function hashSecret(secret) {
  if (!/^[0-9a-f]{64}$/.test(String(secret||''))) throw new Error('餐票凭据格式不正确');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function ticketListLoad(storage) {
  try {const list=JSON.parse(storage.getItem(TICKET_STORAGE_KEY)||'[]'); return Array.isArray(list) ? list.filter(x=>x && /^[0-9a-f]{64}$/.test(x.secret) && (!x.id || ticketIdValid(x.id))).slice(-100) : [];} catch{return [];}
}
export function ticketListSave(storage, list) {storage.setItem(TICKET_STORAGE_KEY,JSON.stringify(list.slice(-100)));}
export function putLocalTicket(storage, record) {
  const list=ticketListLoad(storage).filter(x=> x.secret!==record.secret && (!record.id || x.id!==record.id));
  list.push(record); ticketListSave(storage,list);
}
export function claimEligibility(reservation, settings, today, nowTime) {
  if (!reservation) return 'missing';
  if (reservation.redeemStatus === 'used' || reservation.redeemedAt) return 'used';
  if (reservation.redeemStatus === 'exception') return 'exception';
  if (!settings?.eTicketEnabled) return 'disabled';
  if (reservation.date !== today) return 'day';
  const meal = settings.meals?.find(m => m.id === reservation.mealId);
  if (!meal?.enabled) return 'disabled';
  if (nowTime < reservation.mealStart) return 'early';
  if (nowTime >= reservation.mealEnd) return 'late';
  return 'open';
}
export function visualMarker() {
  const colors=['#146B53','#235FAA','#734CA5','#A34D50'];
  const signs=['◆','●','▲','✦'];
  const n = new Uint8Array(3);crypto.getRandomValues(n);
  return {color:colors[n[0]%colors.length],symbol:signs[n[1]%signs.length],number:String(n[2]).padStart(3,'0')};
}
