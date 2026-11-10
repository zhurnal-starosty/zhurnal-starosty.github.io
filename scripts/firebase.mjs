// Shared Firebase Admin init.
// Credentials: env FIREBASE_SERVICE_ACCOUNT (JSON text, used in GitHub Actions)
// or env FIREBASE_KEY_FILE (path to the key file, for local runs).
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

export const DATABASE_URL = 'https://pi26-7-default-rtdb.europe-west1.firebasedatabase.app';

export function initFirebase() {
  let json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json && process.env.FIREBASE_KEY_FILE) json = readFileSync(process.env.FIREBASE_KEY_FILE, 'utf8');
  if (!json) throw new Error('No credentials: set FIREBASE_SERVICE_ACCOUNT or FIREBASE_KEY_FILE');
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(json)),
    databaseURL: DATABASE_URL,
  });
  return admin.database();
}
