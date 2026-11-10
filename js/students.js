// Student list helpers: parsing pasted text / spreadsheet rows, links, ordering.

const collator = new Intl.Collator('uk', { sensitivity: 'base', numeric: true });

/** Students object -> array sorted by `order` (then name). */
export function sortedStudents(students) {
  return Object.entries(students || {})
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || collator.compare(a.name || '', b.name || ''));
}

export const normName = s => (s || '').toLowerCase().replace(/[’'`ʼ]/g, '').replace(/\s+/g, ' ').trim();

/** "@nick", "t.me/nick", "https://t.me/nick" -> "nick" */
export function cleanTg(v) {
  const m = String(v || '').trim().match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z0-9_]{3,32})\/?$/);
  return m ? m[1] : '';
}

/** Normalises Ukrainian phone numbers to +380XXXXXXXXX when possible. */
export function cleanPhone(v) {
  const digits = String(v || '').replace(/[^\d+]/g, '');
  const d = digits.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('380')) return '+' + d;
  if (d.length === 10 && d.startsWith('0')) return '+38' + d;
  if (d.length >= 7 && d.length <= 15) return (digits.startsWith('+') ? '+' : '') + d;
  return '';
}

export function formatPhone(p) {
  const m = (p || '').match(/^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : (p || '');
}

const TG_RE = /(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)([A-Za-z0-9_]{3,32})|@([A-Za-z0-9_]{3,32})/;
const PHONE_RE = /(?:\+?38)?[\s(-]*0\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|\+\d[\d\s()-]{8,16}\d/;

/**
 * One line of pasted text or one spreadsheet row (cells joined by tabs) -> {name, tg, phone, note}.
 * Accepts "1. Андрієнко Артьом @coolchpl +380671234567", "Андрієнко Артьом<TAB>coolchpl<TAB>067 123 45 67", etc.
 */
export function parseLine(line) {
  let rest = String(line || '').replace(/ /g, ' ').trim();
  if (!rest) return null;
  let tg = '', phone = '';
  const cells = rest.split(/\t|;/).map(c => c.trim()).filter(Boolean);
  const nameParts = [], noteParts = [];

  for (let cell of cells) {
    const t = cell.match(TG_RE);
    if (t && !tg) { tg = t[1] || t[2]; cell = cell.replace(t[0], ' ').trim(); }
    const p = cell.match(PHONE_RE);
    if (p && !phone) { phone = cleanPhone(p[0]); cell = cell.replace(p[0], ' ').trim(); }
    // A bare nickname in its own column (Latin letters/digits/_ only).
    if (!tg && cells.length > 1 && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(cell)) { tg = cell; continue; }
    if (!cell) continue;
    if (!nameParts.length) nameParts.push(cell); else noteParts.push(cell);
  }
  let name = (nameParts[0] || '').replace(/^\s*\d{1,3}\s*[.)\-–]?\s+/, ''); // leading numbering "1." / "1)" / "1 -"
  // Text in brackets goes to the note: "Іванов Іван (староста)" -> note "староста"; empty brackets are dropped.
  const bracketed = [];
  name = name.replace(/[([{]\s*([^)\]}]*?)\s*[)\]}]/g, (_, inner) => { if (inner.trim()) bracketed.push(inner.trim()); return ' '; });
  noteParts.unshift(...bracketed);
  name = name
    .replace(/[\s,;:\-–—]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(name)) return null; // header rows, empty lines
  if (/^(піб|прізвище|ім.?я|name|№|студент)/i.test(name) && !tg && !phone) return null;
  return { name, tg, phone, note: noteParts.join(', ') };
}

/** Text -> parsed students, marking which already exist (by normalised name). */
export function parseList(text, existing) {
  const have = new Set(existing.map(s => normName(s.name)));
  const seen = new Set();
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const p = parseLine(line);
    if (!p) continue;
    const key = normName(p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ ...p, exists: have.has(key) });
  }
  return rows;
}

let xlsxPromise = null;
/** Reads .xlsx/.xls/.csv into text lines (cells joined by tabs). SheetJS is loaded on demand. */
export async function fileToText(file) {
  if (/\.(csv|txt)$/i.test(file.name)) return await file.text();
  xlsxPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error('Не вдалося завантажити модуль Excel')); };
    document.head.appendChild(s);
  });
  const XLSX = await xlsxPromise;
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows.map(r => r.map(c => String(c).trim()).filter(Boolean).join('\t')).join('\n');
}
