/**
 * Consistent employee fuzzy search in both the real GitHub API and demo API.
 * Accepts partial employee ID or employee name. Never changes IDs: '8' != '008'.
 */
export function normalizeEmployeeQuery(input) {
  return String(input ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ').trim();
}

export function validEmployeeQuery(input) {
  const q = String(input ?? '').trim();
  return q.length > 0 && q.length <= 80 && !/[\u0000-\u001f\u007f]/.test(q);
}

export function searchEmployees(employees, input, limit = 12) {
  if (!validEmployeeQuery(input)) return [];
  const q = normalizeEmployeeQuery(input);
  const numeric = /^\d+$/.test(q);
  if (numeric && q.length > 24) return [];
  const tokens = q.split(' ');
  const results = [];
  for (const employee of employees) {
    const id = String(employee?.employeeId ?? '');
    const name = normalizeEmployeeQuery(employee?.name);
    let rank = -1;
    if (numeric && id.includes(q)) {
      rank = id === q ? 0 : id.startsWith(q) ? 1 : 2;
    } else if (name) {
      if (name === q) rank = 3;
      else if (name.startsWith(q)) rank = 4;
      else if (name.split(' ').some(word => word.startsWith(q))) rank = 5;
      else if (name.includes(q)) rank = 6;
      else if (tokens.length > 1 && tokens.every(part => name.includes(part))) rank = 7;
    }
    if (rank >= 0) results.push({employee, id, name, rank});
  }
  const collator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
  results.sort((a, b) => a.rank - b.rank ||
    (a.rank <= 2 ? a.id.length - b.id.length : a.name.length - b.name.length) ||
    collator.compare(a.rank <= 2 ? a.id : a.name, b.rank <= 2 ? b.id : b.name) ||
    a.id.localeCompare(b.id));
  return results.slice(0, limit).map(x => x.employee);
}
