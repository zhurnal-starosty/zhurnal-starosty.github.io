// Prints a Firebase custom token for a UI test user (uid must start with "ui-test-").
// In the browser console of the site:
//   const { signInWithCustomToken } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
//   const { auth } = await import('/js/fb.js'); await signInWithCustomToken(auth, '<token>');
//   node test-token.mjs ui-test-owner
//   node test-token.mjs --cleanup     removes ui-test-* users' data and claimed test groups
import { initFirebase, adminAuth } from './firebase.mjs';

const arg = process.argv[2];
const db = initFirebase();
if (arg === '--cleanup') {
  const users = (await db.ref('users').once('value')).val() || {};
  const groups = (await db.ref('groups').once('value')).val() || {};
  const u = {};
  for (const uid of Object.keys(users)) if (uid.startsWith('ui-test-')) u[`users/${uid}`] = null;
  for (const uid of Object.keys((await db.ref('archives').once('value')).val() || {})) if (uid.startsWith('ui-test-')) u[`archives/${uid}`] = null;
  for (const [gid, g] of Object.entries(groups)) {
    if (g.owner?.startsWith('ui-test-')) Object.assign(u, { [`groups/${gid}`]: null, [`taken/${gid}`]: null, [`invites/${gid}`]: null, [`journals/${gid}`]: null });
  }
  await db.ref().update(u);
  console.log('removed', Object.keys(u));
  // Auth records created by custom-token sign-ins (UI tests and test-rules.mjs)
  const list = await adminAuth().listUsers(1000);
  const testUids = list.users.map(x => x.uid).filter(uid => uid.startsWith('ui-test-') || uid.startsWith('rules-test-'));
  if (testUids.length) await adminAuth().deleteUsers(testUids);
  console.log('deleted auth users:', testUids.join(', ') || '(none)');
} else {
  if (!arg?.startsWith('ui-test-')) { console.error('usage: node test-token.mjs ui-test-<name> | --cleanup'); process.exit(1); }
  console.log(await adminAuth().createCustomToken(arg));
}
process.exit(0);
