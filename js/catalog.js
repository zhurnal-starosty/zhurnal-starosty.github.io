// CIST catalog helpers: course from the group name, grouping like on cist.nure.ua.

// Faculty tab order as on the CIST timetable page; unknown ones go last.
const FACULTY_ORDER = ['КН', 'КІІТ', 'ІТМ', 'ІРТМ', 'ННІ ЛБІ', 'АКІТС', 'КБ', 'ФЗН', 'ЦПО', 'ФНІГ', 'ЦОНІГ', 'Аспірантура', 'ЦДП', 'Інші'];
const FACULTY_ALIAS = { ITM: 'ІТМ' }; // CIST spells this one in Latin

export const facultyLabel = f => FACULTY_ALIAS[f.abbr] || f.abbr;

/** Start year of the academic year containing `now` (Sep–Aug). */
export function academicYear(now = new Date()) {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * "ПІ-26-7"   -> {prefix:'ПІ', course:1}
 * "ІПЗм-25-1" -> {prefix:'ІПЗ', course:6}   (master's: +4, like CIST)
 * "КНТу-24-1" -> {prefix:'КНТ', course:3}
 */
export function groupInfo(name, now = new Date()) {
  const m = name.match(/^(.+?)-(\d{2})-/);
  if (!m) return { prefix: name, course: 0 };
  const raw = m[1];
  const prefix = raw.replace(/[a-zа-яіїєґ]+$/u, '') || raw;
  const tail = raw.slice(prefix.length);
  const masters = tail.includes('м');
  const course = academicYear(now) - (2000 + Number(m[2])) + 1 + (masters ? 4 : 0);
  return { prefix, course: course >= 1 && course <= 11 ? course : 0 };
}

const collator = new Intl.Collator('uk', { numeric: true });

/** Faculties sorted like CIST, each with courses -> prefixes -> groups. */
export function buildTree(catalog) {
  const facs = Object.entries(catalog.faculties || {}).map(([id, f]) => {
    const courses = {};
    for (const dir of Object.values(f.directions || {})) {
      for (const [gid, name] of Object.entries(dir.groups || {})) {
        const { prefix, course } = groupInfo(name);
        const c = (courses[course] ||= {});
        (c[prefix] ||= []).push({ id: gid, name });
      }
    }
    for (const c of Object.values(courses)) for (const list of Object.values(c)) list.sort((a, b) => collator.compare(a.name, b.name));
    return { id, abbr: facultyLabel(f), name: f.name, courses };
  });
  const rank = a => { const i = FACULTY_ORDER.indexOf(a); return i < 0 ? 99 : i; };
  return facs.sort((a, b) => rank(a.abbr) - rank(b.abbr) || collator.compare(a.abbr, b.abbr));
}

/** Search groups by name, ignoring case, spaces, dashes and Latin/Cyrillic look-alikes. */
const norm = s => s.toLowerCase().replace(/[\s\-–]/g, '')
  .replace(/i/g, 'і').replace(/p/g, 'р').replace(/k/g, 'к').replace(/h/g, 'н').replace(/t/g, 'т')
  .replace(/m/g, 'м').replace(/c/g, 'с').replace(/e/g, 'е').replace(/a/g, 'а').replace(/o/g, 'о').replace(/x/g, 'х');

export function searchGroups(catalog, query, limit = 30) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const [gid, g] of Object.entries(catalog.groups || {})) {
    if (norm(g.name).includes(q)) out.push({ id: gid, ...g });
  }
  return out.sort((a, b) => collator.compare(a.name, b.name)).slice(0, limit);
}
