// Group membership operations. Every write here is checked by database.rules.json.
import { read, r, set, update, remove } from './fb.js';

/** Claim a free group as its starosta. Throws {code:'taken'} if someone was faster. */
export async function claimGroup(user, profile, gid, groupName, carryStudents = null) {
  try {
    await update(r(''), {
      [`groups/${gid}`]: { owner: user.uid, name: groupName, claimedAt: Date.now() },
      [`taken/${gid}`]: true,
    });
  } catch (e) {
    if (/permission/i.test(e.message)) throw Object.assign(new Error('taken'), { code: 'taken' });
    throw e;
  }
  // Fresh journal: a previous starosta of this group must not leave data behind.
  const journal = { members: { [user.uid]: { name: profile.name, role: 'owner' } }, createdAt: Date.now() };
  if (carryStudents) journal.students = carryStudents;
  await set(r(`journals/${gid}`), journal);
  await update(r(`users/${user.uid}`), { groupId: gid, role: 'owner' });
}

/** Join a taken group as a deputy using the starosta's invite code. Throws {code:'bad-code'}. */
export async function joinAsDeputy(user, profile, gid, code) {
  const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const formatted = clean.length === 8 ? clean.slice(0, 4) + '-' + clean.slice(4) : code.trim().toUpperCase();
  try {
    await set(r(`groups/${gid}/deputies/${user.uid}`), formatted);
  } catch (e) {
    if (/permission/i.test(e.message)) throw Object.assign(new Error('bad-code'), { code: 'bad-code' });
    throw e;
  }
  await set(r(`journals/${gid}/members/${user.uid}`), { name: profile.name, role: 'deputy' });
  await update(r(`users/${user.uid}`), { groupId: gid, role: 'deputy' });
}

/**
 * Leave the current group. Owner: wipes the journal and frees the group
 * (returns the students list so it can be carried to the new group). Deputy: just leaves.
 */
export async function leaveGroup(user, profile) {
  const gid = profile.groupId;
  let students = null;
  if (profile.role === 'owner') {
    students = await read(`journals/${gid}/students`).catch(() => null);
    await remove(r(`journals/${gid}`));
    await update(r(''), { [`groups/${gid}`]: null, [`taken/${gid}`]: null, [`invites/${gid}`]: null });
  } else {
    await remove(r(`journals/${gid}/members/${user.uid}`)).catch(() => {});
    await remove(r(`groups/${gid}/deputies/${user.uid}`)).catch(() => {});
  }
  await update(r(`users/${user.uid}`), { groupId: null, role: null });
  return students;
}

export const setInvite = (gid, code) => set(r(`invites/${gid}`), { code, createdAt: Date.now() });

export async function removeDeputy(gid, uid) {
  await remove(r(`groups/${gid}/deputies/${uid}`));
  await remove(r(`journals/${gid}/members/${uid}`));
}

/**
 * Checks that the user still belongs to profile.groupId (a deputy may have been removed,
 * a group may have been freed by an admin). Returns the group record or null.
 */
export async function loadMembership(user, profile) {
  if (!profile.groupId) return null;
  try {
    const g = await read(`groups/${profile.groupId}`);
    if (g && (g.owner === user.uid || g.deputies?.[user.uid])) return g;
  } catch { /* permission denied = not a member anymore */ }
  return null;
}
