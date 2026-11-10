// Checks database.rules.json against the LIVE database using throwaway test users
// (custom tokens, uids "rules-test-*") and a fake group id. Cleans up afterwards.
//   node test-rules.mjs
import { DATABASE_URL, WEB_API_KEY, initFirebase, adminAuth } from './firebase.mjs';

const G = 'test-rules-g1';
const G2 = 'test-rules-g2';
const db = initFirebase();

async function signIn(uid) {
  const token = await adminAuth().createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed: ' + JSON.stringify(j));
  return { uid, token: j.idToken };
}

async function call(user, method, path, body) {
  const auth = user ? `?auth=${user.token}` : '';
  const shallow = method === 'GET' ? (auth ? '&' : '?') + 'shallow=true' : '';
  const r = await fetch(`${DATABASE_URL}/${path}.json${auth}${shallow}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.ok;
}

let pass = 0, fail = 0;
async function expect(desc, want, p) {
  const ok = await p;
  if (ok === want) { pass++; console.log('  ok  ', desc); }
  else { fail++; console.log('  FAIL', desc, '— expected', want ? 'ALLOW' : 'DENY'); }
}
const allow = (d, p) => expect(d, true, p);
const deny = (d, p) => expect(d, false, p);

async function cleanup() {
  const u = {};
  for (const g of [G, G2]) for (const k of ['groups', 'taken', 'invites', 'journals', 'schedules']) u[`${k}/${g}`] = null;
  for (const id of ['owner', 'deputy', 'stranger', 'owner2']) { u[`users/rules-test-${id}`] = null; u[`archives/rules-test-${id}`] = null; }
  await db.ref().update(u);
}

await cleanup();
await db.ref(`schedules/${G}`).set({ events: { e1: { date: '2026-11-10' } } });

const [A, D, S, B] = await Promise.all(['owner', 'deputy', 'stranger', 'owner2'].map(n => signIn('rules-test-' + n)));
const now = Date.now();
const CODE = 'ABCD-EFGH';

console.log('catalog / taken / old journal');
await deny('anonymous reads catalog', call(null, 'GET', 'catalog'));
await allow('signed-in reads catalog', call(S, 'GET', 'catalog'));
await allow('signed-in reads taken', call(S, 'GET', 'taken'));
await allow('anonymous reads old journal_pi267 (old site keeps working)', call(null, 'GET', 'journal_pi267'));
await deny('user writes catalog', call(S, 'PUT', 'catalog/x', 1));
await deny('user writes schedules', call(S, 'PUT', `schedules/${G}/x`, 1));

console.log('claiming');
await deny('taken without group', call(S, 'PUT', `taken/${G}`, true));
await deny('group without taken', call(S, 'PUT', `groups/${G}`, { owner: S.uid, name: 'X' }));
await deny('claim in somebody else\'s name', call(S, 'PATCH', '', { [`groups/${G}`]: { owner: A.uid, name: 'X' }, [`taken/${G}`]: true }));
await allow('owner claims free group', call(A, 'PATCH', '', { [`groups/${G}`]: { owner: A.uid, name: 'ПІ-26-7', claimedAt: now }, [`taken/${G}`]: true }));
await deny('stranger claims taken group', call(S, 'PATCH', '', { [`groups/${G}`]: { owner: S.uid, name: 'X' }, [`taken/${G}`]: true }));
await deny('stranger removes taken flag', call(S, 'DELETE', `taken/${G}`));
await deny('extra field in group', call(A, 'PUT', `groups/${G}/hack`, 1));
await deny('owner hands group to another uid', call(A, 'PUT', `groups/${G}/owner`, S.uid));

console.log('privacy');
await deny('stranger reads group', call(S, 'GET', `groups/${G}`));
await deny('stranger reads journal', call(S, 'GET', `journals/${G}`));
await deny('stranger reads schedule', call(S, 'GET', `schedules/${G}`));
await deny('stranger writes journal', call(S, 'PUT', `journals/${G}/marks/e1/s1`, 1));
await allow('owner reads schedule', call(A, 'GET', `schedules/${G}`));
await allow('owner writes journal', call(A, 'PUT', `journals/${G}/members/${A.uid}`, { name: 'A', role: 'owner' }));
await allow('owner reads journal', call(A, 'GET', `journals/${G}`));

console.log('deputies');
await deny('deputy reads invite before joining', call(D, 'GET', `invites/${G}`));
await deny('deputy creates invite', call(D, 'PUT', `invites/${G}`, { code: 'ZZZZ-ZZZZ', createdAt: now }));
await deny('short invite code', call(A, 'PUT', `invites/${G}`, { code: 'ABC', createdAt: now }));
await allow('owner creates invite', call(A, 'PUT', `invites/${G}`, { code: CODE, createdAt: now }));
await deny('join with wrong code', call(D, 'PUT', `groups/${G}/deputies/${D.uid}`, 'WRONG-CODE'));
await deny('join under someone else\'s uid', call(D, 'PUT', `groups/${G}/deputies/${S.uid}`, CODE));
await deny('owner joins own group as deputy', call(A, 'PUT', `groups/${G}/deputies/${A.uid}`, CODE));
await allow('join with right code', call(D, 'PUT', `groups/${G}/deputies/${D.uid}`, CODE));
await allow('deputy reads journal', call(D, 'GET', `journals/${G}`));
await allow('deputy writes marks', call(D, 'PUT', `journals/${G}/marks/e1/s1`, 1));
await allow('deputy reads schedule', call(D, 'GET', `schedules/${G}`));
await deny('deputy changes owner', call(D, 'PUT', `groups/${G}/owner`, D.uid));
await deny('deputy deletes group', call(D, 'DELETE', `groups/${G}`));
await deny('deputy rotates invite', call(D, 'PUT', `invites/${G}/code`, 'QQQQ-QQQQ'));
await allow('owner removes deputy', call(A, 'DELETE', `groups/${G}/deputies/${D.uid}`));
await deny('removed deputy reads journal', call(D, 'GET', `journals/${G}`));
await allow('deputy re-joins', call(D, 'PUT', `groups/${G}/deputies/${D.uid}`, CODE));
await allow('deputy leaves by himself', call(D, 'DELETE', `groups/${G}/deputies/${D.uid}`));

console.log('transfer of the starosta role');
await allow('deputy re-joins (for transfer)', call(D, 'PUT', `groups/${G}/deputies/${D.uid}`, CODE));
await deny('owner hands group to a non-deputy', call(A, 'PATCH', `groups/${G}`, { owner: S.uid }));
await deny('deputy takes the group himself', call(D, 'PATCH', `groups/${G}`, { owner: D.uid, [`deputies/${D.uid}`]: null }));
await deny('transfer keeping new owner listed as deputy', call(A, 'PATCH', `groups/${G}`, { owner: D.uid }));
await allow('owner transfers to deputy and stays as deputy', call(A, 'PATCH', `groups/${G}`, { owner: D.uid, [`deputies/${D.uid}`]: null, [`deputies/${A.uid}`]: 'transfer' }));
await allow('ex-owner (now deputy) still reads journal', call(A, 'GET', `journals/${G}`));
await deny('ex-owner can no longer rotate invite', call(A, 'PUT', `invites/${G}`, { code: 'WWWW-WWWW', createdAt: now }));
await allow('new owner transfers back', call(D, 'PATCH', `groups/${G}`, { owner: A.uid, [`deputies/${A.uid}`]: null }));

console.log('archives');
await allow('user saves own archive', call(A, 'PUT', `archives/${A.uid}/${G}`, { name: 'ПІ-26-7', savedAt: now, marks: { e1: { s1: 1 } } }));
await allow('user reads own archive', call(A, 'GET', `archives/${A.uid}`));
await deny('stranger reads archive', call(S, 'GET', `archives/${A.uid}`));
await deny('stranger writes archive', call(S, 'PUT', `archives/${A.uid}/x`, 1));
await allow('user deletes own archive', call(A, 'DELETE', `archives/${A.uid}`));

console.log('users');
await allow('user writes own profile', call(A, 'PUT', `users/${A.uid}`, { name: 'Owner', email: 'a@x', groupId: G, role: 'owner', createdAt: now }));
await deny('profile without name', call(S, 'PUT', `users/${S.uid}`, { email: 'x' }));
await deny('profile extra field', call(A, 'PUT', `users/${A.uid}/admin`, true));
await deny('bad role', call(A, 'PUT', `users/${A.uid}/role`, 'admin'));
await deny('read other profile', call(S, 'GET', `users/${A.uid}`));
await deny('write other profile', call(S, 'PUT', `users/${A.uid}/name`, 'hacked'));
await deny('user makes himself admin', call(S, 'PUT', `admins/${S.uid}`, true));

console.log('release and re-claim');
await deny('stranger releases group', call(S, 'PATCH', '', { [`groups/${G}`]: null, [`taken/${G}`]: null }));
await allow('owner wipes journal', call(A, 'DELETE', `journals/${G}`));
await allow('owner releases group', call(A, 'PATCH', '', { [`groups/${G}`]: null, [`taken/${G}`]: null, [`invites/${G}`]: null }));
await deny('ex-owner reads journal', call(A, 'GET', `journals/${G}`));
await allow('another user claims released group', call(B, 'PATCH', '', { [`groups/${G}`]: { owner: B.uid, name: 'ПІ-26-7', claimedAt: now }, [`taken/${G}`]: true }));
await allow('owner of g1 can claim g2 as well (switch flow)', call(A, 'PATCH', '', { [`groups/${G2}`]: { owner: A.uid, name: 'ПІ-26-8', claimedAt: now }, [`taken/${G2}`]: true }));

await cleanup();
await adminAuth().deleteUsers([A, D, S, B].map(u => u.uid)); // auth records created by custom-token sign-in
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
