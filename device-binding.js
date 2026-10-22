/** V14.6 best-effort browser binding. NOT a hardware identity or security boundary. */
export const DEVICE_STORAGE_KEY = 'sanhua-canteen-browser-binding-v14.6';
export const DEVICE_ERRORS = Object.freeze({
  INVALID: 'DEVICE_ID_REQUIRED',
  BROWSER: 'DEVICE_BOUND_TO_OTHER_EMPLOYEE',
  EMPLOYEE: 'EMPLOYEE_BOUND_TO_OTHER_DEVICE',
  TRANSFER: 'DEVICE_TRANSFER_REQUIRES_ADMIN',
  MIXED: 'DEVICE_LEGACY_MIXED_EMPLOYEES',
});
export function validDeviceHash(value) { return /^[0-9a-f]{64}$/.test(String(value || '')); }
export function makeBrowserId() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('需要 HTTPS 安全浏览器环境才能生成设备标识');
  const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function hashBrowserId(id) {
  if (!validDeviceHash(id)) throw new Error(DEVICE_ERRORS.INVALID);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export function loadBrowserBinding(storage,demo=false) {
  const key=DEVICE_STORAGE_KEY+(demo?'-demo':'');
  let item=null;
  try {item=JSON.parse(storage.getItem(key)||'null');}catch{}
  if (validDeviceHash(item?.id)) return {id:item.id,employeeId:/^\d{1,24}$/.test(item.employeeId||'')?item.employeeId:''};
  const created={id:makeBrowserId(),employeeId:''};
  storage.setItem(key,JSON.stringify(created));
  return created;
}
export function pinBrowserEmployee(storage,employeeId,demo=false) {
  const key=DEVICE_STORAGE_KEY+(demo?'-demo':'');
  const employee=String(employeeId||'');
  if (!/^\d{1,24}$/.test(employee)) throw new Error(DEVICE_ERRORS.INVALID);
  const binding=loadBrowserBinding(storage,demo);
  if (binding.employeeId && binding.employeeId!==employee) throw new Error(DEVICE_ERRORS.BROWSER);
  if (binding.employeeId!==employee) storage.setItem(key,JSON.stringify({...binding,employeeId:employee}));
  return {...binding,employeeId:employee};
}
export function localEmployeeCheck(binding,employeeId,verifiedEmployees=[],unknown=false) {
  const owners=new Set(verifiedEmployees.map(String).filter(Boolean));
  if (unknown) return DEVICE_ERRORS.MIXED; // Do not silently ignore unreachable older tickets.
  if (owners.size>1) return DEVICE_ERRORS.MIXED;
  if (binding.employeeId && binding.employeeId!==String(employeeId)) return DEVICE_ERRORS.BROWSER;
  if (owners.size && !owners.has(String(employeeId))) return DEVICE_ERRORS.BROWSER;
  return '';
}
export function normalizedDeviceBindings(data) {
  if (!data.deviceBindings || typeof data.deviceBindings!=='object' || Array.isArray(data.deviceBindings)) data.deviceBindings={};
  return data.deviceBindings;
}
export function checkDeviceBinding(data,employeeId,deviceHash) {
  if (!validDeviceHash(deviceHash)) throw new Error(DEVICE_ERRORS.INVALID);
  const entries=normalizedDeviceBindings(data);
  const id=String(employeeId);
  const existing=entries[id];
  if (existing && existing!==deviceHash) throw new Error(DEVICE_ERRORS.EMPLOYEE);
  if (Object.entries(entries).some(([who,hash])=>who!==id&&hash===deviceHash)) throw new Error(DEVICE_ERRORS.BROWSER);
}
export function attachDeviceBooking(data,employeeId,deviceHash) {
  checkDeviceBinding(data,employeeId,deviceHash);
  normalizedDeviceBindings(data)[String(employeeId)]=deviceHash;
}
export function deviceTicketAllowed(data,reservation,deviceHash) {
  if (reservation?.deviceBindingSuspended) return false;
  const binding=normalizedDeviceBindings(data)[String(reservation?.employeeId)];
  if (binding) return binding===deviceHash;
  // Only historical V14.5 tickets lacking a device marker can continue
  // functioning without a binding. New V14.6 reservations always have one.
  return !reservation?.deviceBound;
}
