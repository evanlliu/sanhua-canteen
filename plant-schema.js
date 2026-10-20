/** V12 confirmed format: C + 10 uppercase hexadecimal random digits + - + Plant D/G/B/H.
 * e.g. CEBA40FD604-D. Keep legacy codes readable/deletable.
 */
export const PLANTS = Object.freeze(['D','G','B','H']);
export function validPlant(value) { return typeof value === 'string' && PLANTS.includes(value); }
export function plantLabel(value) { return validPlant(value) ? `Plant ${value}` : '—'; }
export function reservationCode(plant, randomBytes = crypto.getRandomValues(new Uint8Array(5))) {
  if (!validPlant(plant)) throw new Error('请选择 Plant D / G / B / H');
  const randomHex = Array.from(randomBytes, n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `C${randomHex}-${plant}`;
}
export function validReservationCode(value) { return /^C[A-F0-9]{10}(?:-[DGBH])?$/.test(value); }
