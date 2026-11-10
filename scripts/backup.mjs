// Dumps the whole Realtime Database to a JSON file (read-only).
// Usage: FIREBASE_KEY_FILE=... node backup.mjs <output.json>
import { writeFileSync } from 'node:fs';
import { initFirebase } from './firebase.mjs';

const out = process.argv[2];
if (!out) { console.error('usage: node backup.mjs <output.json>'); process.exit(1); }

const db = initFirebase();
const snap = await db.ref('/').once('value');
const data = snap.val();
writeFileSync(out, JSON.stringify(data, null, 1));
console.log('saved', out, '| top-level keys:', Object.keys(data || {}).join(', '));
process.exit(0);
