// Uploads ../database.rules.json to the Realtime Database.
// The rules currently in force are saved first to <backupDir>/rules-<timestamp>.json.
//   node deploy-rules.mjs [--backup-dir DIR] [--dry-run]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATABASE_URL, accessToken } from './firebase.mjs';

const args = process.argv.slice(2);
const backupDir = args.includes('--backup-dir') ? args[args.indexOf('--backup-dir') + 1] : null;
const rulesPath = fileURLToPath(new URL('../database.rules.json', import.meta.url));
const rules = readFileSync(rulesPath, 'utf8');
JSON.parse(rules); // fail early on syntax errors

const token = await accessToken();
const url = `${DATABASE_URL}/.settings/rules.json?access_token=${token}`;

const current = await fetch(url).then(r => r.text());
if (backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const file = `${backupDir}/rules-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, current);
  console.log('current rules saved to', file);
}
if (args.includes('--dry-run')) { console.log('dry run, not uploading'); process.exit(0); }

const res = await fetch(url, { method: 'PUT', body: rules });
const body = await res.text();
if (!res.ok) { console.error('FAILED', res.status, body); process.exit(1); }
console.log('rules deployed:', body);
