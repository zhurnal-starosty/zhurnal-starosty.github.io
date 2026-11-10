// Shared Firebase Admin init.
// Credentials: env FIREBASE_SERVICE_ACCOUNT (JSON text, used in GitHub Actions)
// or env FIREBASE_KEY_FILE (path to the key file, for local runs).
import { readFileSync } from 'node:fs';
import admin from 'firebase-admin';

export const DATABASE_URL = 'https://pi26-7-default-rtdb.europe-west1.firebasedatabase.app';

// Public web config (same as in the site's js/fb.js) — used by tests to sign in as test users.
export const WEB_API_KEY = 'AIzaSyAqj1dBvByK6Vwnz0nEaHyHVyKY8h1pIvU';

let credential = null;

function loadCredential() {
  if (credential) return credential;
  let json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!json && process.env.FIREBASE_KEY_FILE) json = readFileSync(process.env.FIREBASE_KEY_FILE, 'utf8');
  if (!json) throw new Error('No credentials: set FIREBASE_SERVICE_ACCOUNT or FIREBASE_KEY_FILE');
  credential = admin.credential.cert(JSON.parse(json));
  return credential;
}

export function initFirebase() {
  if (!admin.apps.length) admin.initializeApp({ credential: loadCredential(), databaseURL: DATABASE_URL });
  return admin.database();
}

export const adminAuth = () => { initFirebase(); return admin.auth(); };

/** OAuth token of the service account (for REST calls such as rules deployment). */
export async function accessToken() {
  return (await loadCredential().getAccessToken()).access_token;
}
