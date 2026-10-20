/**
 * V13 booking number: YYMMDD-PLANT-NNNN, e.g. 261020-B-0001.
 * NNNN is monotonically increasing per local calendar date AND per Plant.
 * Keep V12 random IDs (with/without Plant suffix) valid for historic records.
 */
export const PLANTS = Object.freeze(['D', 'G', 'B', 'H']);
export function validPlant(value) { return typeof value === 'string' && PLANTS.includes(value); }
export function plantLabel(value) { return validPlant(value) ? `Plant ${value}` : '—'; }

export function reservationCode(date, plant, sequence) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(date)) throw new Error('无效的用餐日期');
  if (!validPlant(plant)) throw new Error('请选择 Plant D / G / B / H');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9999) throw new Error('当日该 Plant 的预约流水号已达到 9999，请联系管理员');
  return `${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${plant}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Allocate under the GitHub SHA-guarded read-modify-write transaction.
 * The persisted high-water counter prevents reuse after deleting a booking;
 * scanning surviving IDs allows safe upgrading from data lacking counters.
 */
export function nextReservationCode(data, date, plant) {
  const prefix = reservationCode(date, plant, 1).slice(0, -4);
  const key = `${date}-${plant}`;
  if (!data.sequenceCounters || typeof data.sequenceCounters !== 'object' || Array.isArray(data.sequenceCounters)) {
    data.sequenceCounters = {};
  }
  const stored = data.sequenceCounters[key];
  let max = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  for (const item of (Array.isArray(data.reservations) ? data.reservations : [])) {
    const id = String(item?.id || '');
    if (id.startsWith(prefix) && /^\d{4}$/.test(id.slice(prefix.length))) {
      max = Math.max(max, Number(id.slice(prefix.length)));
    }
  }
  const next = max + 1;
  const id = reservationCode(date, plant, next);
  data.sequenceCounters[key] = next;
  return id;
}

export function validReservationCode(value) {
  return typeof value === 'string' && (
    /^\d{6}-[DGBH]-(?:\d{4})$/.test(value) ||
    /^C[A-F0-9]{10}(?:-[DGBH])?$/.test(value)
  );
}
