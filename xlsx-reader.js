/** Small local, offline .xlsx reader for roster-style workbooks.
 * Uses bundled JSZip (MIT) and browser DOMParser, no external requests.
 * Reads the first worksheet, strings (including shared strings / rich text),
 * cached formula values, and zero-padded integer number formats.
 */
function loadScript(path) {
  return new Promise((resolve, reject) => {
    if (window.JSZip) return resolve();
    const tag = document.createElement('script'); tag.src = path; tag.async = true;
    tag.onload = () => window.JSZip ? resolve() : reject(new Error('ZIP 解压模块初始化失败'));
    tag.onerror = () => reject(new Error('ZIP 解压模块加载失败'));
    document.head.append(tag);
  });
}
function xml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Excel XML 结构损坏');
  return doc;
}
function children(parent, name) {
  return [...parent?.getElementsByTagName(name) || []];
}
function textOf(parent, name) { return children(parent, name)[0]?.textContent || ''; }
function colNumber(reference) {
  let n = 0;
  for (const char of (String(reference || '').match(/^[A-Z]+/)?.[0] || '')) n = n * 26 + char.charCodeAt(0) - 64;
  return n - 1;
}
function padFormat(s, mask) {
  if (!/^0+$/.test(mask || '') || !/^-?\d+(?:\.0+)?$/.test(s)) return s;
  return s.replace(/\.0+$/, '').padStart(mask.length, '0');
}
export async function readXlsxRows(file) {
  if (file.size > 8_000_000) throw new Error('Excel 文件超过 8MB，请拆分后导入');
  await loadScript('./assets/jszip.min.js');
  let zip;
  try { zip = await window.JSZip.loadAsync(await file.arrayBuffer()); }
  catch { throw new Error('不是有效的 .xlsx 文件或文件已损坏'); }
  const read = async path => zip.file(path)?.async('string');
  const workbookText = await read('xl/workbook.xml');
  if (!workbookText) throw new Error('Excel 缺少工作簿文件，请确认是 .xlsx 格式');
  const workbook = xml(workbookText);
  const firstSheet = children(workbook, 'sheet')[0];
  if (!firstSheet) throw new Error('Excel 没有工作表');
  const relId = firstSheet.getAttribute('r:id') || firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const relText = await read('xl/_rels/workbook.xml.rels');
  const rels = relText ? xml(relText) : null;
  const rel = children(rels, 'Relationship').find(x => x.getAttribute('Id') === relId);
  let target = (rel?.getAttribute('Target') || 'worksheets/sheet1.xml').replace(/^\//, '');
  let sheetPath = target.startsWith('xl/') ? target : `xl/${target}`;
  const segs = [];
  for (const piece of sheetPath.split('/')) { if (piece === '..') segs.pop(); else if (piece && piece !== '.') segs.push(piece); }
  sheetPath = segs.join('/');
  const sheetText = await read(sheetPath);
  if (!sheetText) throw new Error('找不到 Excel 第一张工作表');
  const sharedText = await read('xl/sharedStrings.xml');
  const shared = sharedText ? children(xml(sharedText), 'si').map(item => children(item, 't').map(n => n.textContent || '').join('')) : [];
  const stylesText = await read('xl/styles.xml');
  let numberFormats = {};
  let xfFormatIds = [];
  if (stylesText) {
    const styles = xml(stylesText);
    for (const fmt of children(styles, 'numFmt')) numberFormats[fmt.getAttribute('numFmtId')] = fmt.getAttribute('formatCode');
    const cellXfs = children(styles, 'cellXfs')[0];
    xfFormatIds = cellXfs ? [...cellXfs.children].map(node => node.getAttribute('numFmtId')) : [];
  }
  const cells = children(xml(sheetText), 'sheetData')[0];
  if (!cells) return [];
  const result = [];
  for (const row of [...cells.children].filter(n => n.localName === 'row')) {
    const index = Number(row.getAttribute('r') || (result.length + 1));
    if (index > 15020) throw new Error('工作表行数太多，单次最多支持 15000 名员工');
    const values = [];
    let fallbackCol = 0;
    for (const c of [...row.children].filter(n => n.localName === 'c')) {
      const col = colNumber(c.getAttribute('r')); const colIndex = col >= 0 ? col : fallbackCol;
      const type = c.getAttribute('t');
      let v = textOf(c, 'v');
      if (type === 'inlineStr') v = children(c, 'is').flatMap(item => children(item, 't')).map(n => n.textContent || '').join('');
      else if (type === 's') v = shared[Number(v)] ?? '';
      else if (type === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
      else if (type !== 'str') {
        const mask = numberFormats[xfFormatIds[Number(c.getAttribute('s') || 0)]];
        v = padFormat(v, mask);
      }
      values[colIndex] = v;
      fallbackCol = colIndex + 1;
    }
    // Keep actual row order; empty rows before the header are harmlessly included.
    if (index - 1 < 15020) result[index - 1] = values;
  }
  return result.map(x => x || []);
}
