// Pulls timetables from CIST into Firebase.
//
//   node sync.mjs                      catalog (if stale) + every registered group (/groups keys)
//   node sync.mjs --group 12512017     only these groups (repeatable), registered or not
//   node sync.mjs --catalog            force catalog refresh
//   node sync.mjs --dry-run --out x.json   fetch and diff, write nothing to Firebase
//
// Credentials: see firebase.mjs. In --dry-run mode without credentials the diff is
// computed against an empty database.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { currentSemester, fetchCatalog, fetchEvents, fetchSubjects } from './cist.mjs';
import { initFirebase } from './firebase.mjs';

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const values = n => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
const DRY = flag('--dry-run');
const OUT = values('--out')[0];
const CATALOG_MAX_AGE_MS = 20 * 3600 * 1000;
const PAUSE_MS = 1500; // be gentle with CIST between groups

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = obj => createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let db = null;
try { db = initFirebase(); } catch (e) { if (!DRY) throw e; log('dry run without database:', e.message); }
const read = async path => (db ? (await db.ref(path).once('value')).val() : null);

const report = { startedAt: new Date().toISOString(), dryRun: DRY, catalog: null, groups: {} };
const updates = {};
const now = Date.now();

/* ---------- catalog ---------- */
const catalogUpdatedAt = await read('catalog/updatedAt');
if (flag('--catalog') || !catalogUpdatedAt || now - catalogUpdatedAt > CATALOG_MAX_AGE_MS) {
  try {
    const cat = await fetchCatalog();
    updates['catalog'] = { ...cat, updatedAt: now };
    report.catalog = { groups: Object.keys(cat.groups).length, faculties: Object.keys(cat.faculties).length };
    log('catalog:', report.catalog);
  } catch (e) {
    report.catalog = { error: e.message };
    log('catalog FAILED:', e.message);
  }
} else {
  report.catalog = 'fresh';
}

/* ---------- groups ---------- */
let groupIds = values('--group');
if (!groupIds.length) groupIds = Object.keys((await read('groups')) || {});
log('groups to sync:', groupIds.length ? groupIds.join(', ') : '(none)');

const sem = currentSemester();
let failures = 0;

for (const [i, gid] of groupIds.entries()) {
  if (i) await sleep(PAUSE_MS);
  const r = (report.groups[gid] = {});
  try {
    const fresh = await fetchEvents(gid, sem);
    const subjects = await fetchSubjects(gid, sem).catch(e => { r.subjectsError = e.message; return null; });
    const prev = (await read(`schedules/${gid}`)) || {};
    const prevEvents = prev.events || {};

    // Safety: CIST returned nothing but we had pairs -> likely an outage, don't wipe.
    if (!Object.keys(fresh).length && Object.keys(prevEvents).length) {
      r.skipped = 'CIST returned 0 events, keeping previous schedule';
      updates[`schedules/${gid}/checkedAt`] = now;
      log(gid, r.skipped);
      continue;
    }

    // Pairs gone from CIST: keep (flagged) if somebody already marked attendance, else drop.
    const marks = (await read(`journals/${gid}/marks`)) || {};
    const events = { ...fresh };
    let removed = 0, kept = 0;
    for (const [id, ev] of Object.entries(prevEvents)) {
      if (fresh[id]) continue;
      if (marks[id]) { events[id] = { ...ev, removed: true }; kept++; } else removed++;
    }
    const added = Object.keys(fresh).filter(id => !prevEvents[id] || prevEvents[id].removed).length;

    const finalSubjects = subjects || prev.subjects || {};
    const h = hash({ events, subjects: finalSubjects, sem });
    Object.assign(r, { events: Object.keys(fresh).length, added, removed, keptRemoved: kept, changed: h !== prev.hash });

    if (h !== prev.hash) {
      updates[`schedules/${gid}`] = { semester: sem, events, subjects: finalSubjects, hash: h, updatedAt: now, checkedAt: now };
    } else {
      updates[`schedules/${gid}/checkedAt`] = now;
      if (prev.error) updates[`schedules/${gid}/error`] = null;
    }
    log(gid, r);
  } catch (e) {
    failures++;
    r.error = e.message;
    updates[`schedules/${gid}/error`] = { message: e.message.slice(0, 300), at: now };
    log(gid, 'FAILED:', e.message);
  }
}

/* ---------- write ---------- */
if (DRY) {
  log('dry run: nothing written. update paths:', Object.keys(updates).join(', ') || '(none)');
} else if (Object.keys(updates).length) {
  await db.ref().update(updates);
  log('written:', Object.keys(updates).length, 'paths');
}
if (OUT) writeFileSync(OUT, JSON.stringify({ report, updates }, null, 1));

// Fail the workflow only if every group failed (so a single bad group doesn't spam alerts).
process.exit(groupIds.length && failures === groupIds.length ? 1 : 0);
