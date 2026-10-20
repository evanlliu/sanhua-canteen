// Backward-compatible meal naming shared by the staff page, admin page and GitHub store.
export const PRESET = Object.freeze({
  breakfast: { zh: '早餐', en: 'Breakfast', es: 'Desayuno', icon: '🥐' },
  lunch: { zh: '午餐', en: 'Lunch', es: 'Almuerzo', icon: '🍚' },
  dinner: { zh: '晚餐', en: 'Dinner', es: 'Cena', icon: '🍲' },
});
export function mealName(meal, lang = 'zh') {
  if (!meal) return '';
  const preset = PRESET[meal.id] || {};
  const zh = String(meal.nameZh || meal.label || preset.zh || meal.id || '').trim();
  const en = String(meal.nameEn || preset.en || zh).trim();
  const es = String(meal.nameEs || preset.es || zh).trim();
  return lang === 'en' ? en : lang === 'es' ? es : zh;
}
export function normalMeal(m) {
  const id = String(m?.id || '');
  const p = PRESET[id] || {};
  const zh = String(m?.nameZh || m?.label || p.zh || id).trim();
  return {
    id, label: zh, nameZh: zh,
    nameEn: String(m?.nameEn || p.en || zh).trim(),
    nameEs: String(m?.nameEs || p.es || zh).trim(),
    start: m?.start || '11:30', end: m?.end || '14:00', enabled: m?.enabled === true,
  };
}
// Booking is available only DURING the configured meal window (start inclusive, end exclusive).
// HH:mm strings are zero-padded in admin settings, allowing lexical comparison.
export function canBookMeal(meal, today, mealDate, nowTime) {
  return Boolean(meal?.enabled) && mealDate === today && nowTime >= meal.start && nowTime < meal.end;
}
export function mealIcon(id) { return PRESET[id]?.icon || '🍽️'; }
export function reservationMeal(r, meals = [], lang = 'zh') {
  // Snapshot is retained when a meal is removed or renamed.
  const current = meals.find(m => m.id === r.mealId);
  if (current) return mealName(current, lang);
  return mealName({id:r.mealId, label:r.mealNameZh, nameZh:r.mealNameZh, nameEn:r.mealNameEn, nameEs:r.mealNameEs}, lang);
}
