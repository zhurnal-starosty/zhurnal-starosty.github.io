// CIST (cist.nure.ua) client: group catalog, timetable events (CSV export)
// and the subject legend (HTML export). All responses are windows-1251.

const BASE = 'https://cist.nure.ua/ias/app/tt/';
const UA = 'pi26-7-journal-sync (+https://github.com/phskrpp/pi26-7)';

// Standard NURE pair start times -> pair number
const PAIR_BY_START = {
  '07:45': 1, '09:30': 2, '11:15': 3, '13:10': 4,
  '14:55': 5, '16:40': 6, '18:25': 7, '20:10': 8,
};

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = new TextDecoder('windows-1251').decode(await res.arrayBuffer());
  if (/^\s*ORA-\d+/.test(text)) throw new Error(`CIST error: ${text.trim().slice(0, 200)}`);
  return text;
}

const ddmmyyyy = d => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const toISO = dmy => { const [d, m, y] = dmy.split('.'); return `${y}-${m}-${d}`; };

/** Current academic semester: Sep 1 – Jan 31, or Feb 1 – Jul 31. */
export function currentSemester(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  if (m >= 8) return { from: `${y}-09-01`, to: `${y + 1}-01-31` };
  if (m === 1) return { from: `${y - 1}-09-01`, to: `${y}-01-31` };
  return { from: `${y}-02-01`, to: `${y}-07-31` };
}
const isoToDmy = iso => ddmmyyyy(new Date(iso + 'T00:00:00Z'));

/* ---------------- Catalog ---------------- */

/**
 * Returns { faculties: {'f'+facId: {abbr, name, directions: {'d'+dirId:{abbr, name, groups: {gid: name}}}}},
 *           groups: {gid: {name, fac, dir}} }  (flat index for search)
 * Note: CIST swaps fields — `full_name` holds the abbreviation, `short_name` the long name.
 */
export async function fetchCatalog() {
  const data = JSON.parse(await get(BASE + 'P_API_GROUP_JSON'));
  const faculties = {}, groups = {};
  for (const f of data.university.faculties) {
    const fac = { abbr: f.full_name, name: f.short_name, directions: {} };
    for (const d of f.directions || []) {
      const dir = { abbr: d.full_name, name: d.short_name, groups: {} };
      const all = [...(d.groups || []), ...(d.specialities || []).flatMap(s => s.groups || [])];
      for (const g of all) {
        dir.groups[g.id] = g.name;
        groups[g.id] = { name: g.name, fac: 'f' + f.id, dir: 'd' + d.id };
      }
      if (Object.keys(dir.groups).length) fac.directions['d' + d.id] = dir;
    }
    // 'f'/'d' prefixes: Firebase turns objects with small numeric keys into arrays
    if (Object.keys(fac.directions).length) faculties['f' + f.id] = fac;
  }
  return { faculties, groups };
}

/* ---------------- Events (CSV) ---------------- */

function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
}

/** "ОПр Лк DL ПІ-26-4,5,6,7,8,9" -> {subject, type, place, groups} */
export function parseTheme(theme) {
  const t = theme.trim().split(/\s+/);
  // trailing tokens that look like group lists ("ПІ-26-7", "ПІ-26-4,5", "КНТ-26-1,2;ПІ-26-3")
  let end = t.length;
  while (end > 1 && /^[^\s-]+-\d{2}-[\d,;]/.test(t[end - 1])) end--;
  const groups = t.slice(end).join(' ');
  const head = t.slice(0, end);
  const subject = head[0] || theme;
  const type = head[1] || '';
  const place = head.slice(2).join(' ');
  return { subject, type, place, groups };
}

/** Firebase keys can't contain . # $ [ ] / */
const safeKey = s => s.replace(/[.#$[\]/\s]/g, '_');

export async function fetchEvents(groupId, sem) {
  const url = `${BASE}WEB_IAS_TT_GNR_RASP.GEN_GROUP_POTOK_RASP?ATypeDoc=3&Aid_group=${groupId}&Aid_potok=0`
    + `&ADateStart=${isoToDmy(sem.from)}&ADateEnd=${isoToDmy(sem.to)}&AMultiWorkSheet=0`;
  const rows = parseCsv(await get(url));
  if (!rows.length || rows[0][0] !== 'Тема') throw new Error('Unexpected CSV header: ' + JSON.stringify(rows[0]).slice(0, 200));
  const events = {};
  for (const r of rows.slice(1)) {
    const [theme, dStart, tStart, , tEnd] = r;
    if (!/^\d\d\.\d\d\.\d{4}$/.test(dStart)) continue;
    const start = tStart.slice(0, 5), end = tEnd.slice(0, 5);
    const th = parseTheme(theme);
    const date = toISO(dStart);
    let id = safeKey(`${date}_${start.replace(':', '')}_${th.subject}_${th.type}`);
    while (events[id]) id += '+'; // same subject/type twice in one slot (rare)
    events[id] = { date, start, end, pair: PAIR_BY_START[start] || 0, ...th };
  }
  return events;
}

/* ---------------- Subject legend (HTML) ---------------- */

const stripTags = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Returns { abbr: {name, types: {Лк: {hours, teachers: [..]}}} } */
export async function fetchSubjects(groupId, sem) {
  const url = `${BASE}WEB_IAS_TT_GNR_RASP.GEN_GROUP_POTOK_RASP?ATypeDoc=1&Aid_group=${groupId}&Aid_potok=0`
    + `&ADateStart=${isoToDmy(sem.from)}&ADateEnd=${isoToDmy(sem.to)}&AMultiWorkSheet=0`;
  const html = await get(url);
  const subjects = {};
  const rowRe = /<td class="name"><a name="\d+">([^<]+)<\/a><\/td><td>([\s\S]*?)<\/td><\/tr>/g;
  for (const [, abbrRaw, body] of html.matchAll(rowRe)) {
    const abbr = stripTags(abbrRaw);
    const lines = body.split('\n');
    const first = lines[0].indexOf(' : ');
    const name = first >= 0 ? stripTags(lines[0].slice(0, first)) : abbr;
    if (first >= 0) lines[0] = lines[0].slice(first + 3);
    const types = {};
    for (const line of lines) {
      const m = line.match(/^\s*(\S+) \((\d+)\) - ([\s\S]*)$/);
      if (!m) continue;
      const anchors = [...m[3].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map(a => stripTags(a[1]));
      const tp = types[m[1]] || (types[m[1]] = { hours: 0, teachers: [] });
      tp.hours = Math.max(tp.hours, +m[2]);
      for (const teacher of anchors.slice(1)) if (teacher && !tp.teachers.includes(teacher)) tp.teachers.push(teacher);
    }
    subjects[safeKey(abbr)] = { abbr, name, types };
  }
  return subjects;
}
