// Group membership operations. Every write here is checked by database.rules.json.
import { read, r, set, update, remove } from './fb.js';

/**
 * Claim a free group as its starosta. Throws {code:'taken'} if someone was faster.
 * `restore` — an archive {students, marks} to put back; `carryStudents` — students only.
 */
export async function claimGroup(user, profile, gid, groupName, { carryStudents = null, restore = null } = {}) {
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
  if (restore) {
    if (restore.students) journal.students = restore.students;
    if (restore.marks) journal.marks = restore.marks;
    if (restore.manualEvents) journal.manualEvents = restore.manualEvents;
  } else if (carryStudents) {
    journal.students = carryStudents;
  }
  await set(r(`journals/${gid}`), journal);
  if (restore) await remove(r(`archives/${user.uid}/${gid}`));
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

/** Copies the group's journal into /archives/{uid}/{gid} (owner keeps records after leaving). */
async function archiveJournal(user, gid, groupName) {
  const [journal, schedule, prev] = await Promise.all([
    read(`journals/${gid}`),
    read(`schedules/${gid}`).catch(() => null),
    read(`archives/${user.uid}/${gid}`).catch(() => null),
  ]);
  if (!journal?.students && !journal?.marks) return false;
  // Merge with an earlier archive of the same group (newer data wins per pair/student).
  const marks = { ...(prev?.marks || {}) };
  for (const [eid, row] of Object.entries(journal.marks || {})) marks[eid] = { ...(marks[eid] || {}), ...row };
  // Keep the pairs that have marks, so the archive stays readable even after the schedule is gone.
  const events = { ...(prev?.events || {}) };
  for (const id of Object.keys(journal.marks || {})) {
    const ev = schedule?.events?.[id] || journal.manualEvents?.[id];
    if (ev) events[id] = ev;
  }
  await set(r(`archives/${user.uid}/${gid}`), {
    name: groupName, savedAt: Date.now(),
    students: { ...(prev?.students || {}), ...(journal.students || {}) },
    marks: Object.keys(marks).length ? marks : null,
    manualEvents: { ...(prev?.manualEvents || {}), ...(journal.manualEvents || {}) },
    events, subjects: schedule?.subjects || prev?.subjects || null,
  });
  return true;
}

/**
 * Owner leaves and frees the group. keepRecords: archive the journal into the account first.
 * Returns the students list (for carrying over into the next group).
 */
export async function releaseGroup(user, profile, group, { keepRecords }) {
  const gid = profile.groupId;
  const students = await read(`journals/${gid}/students`).catch(() => null);
  if (keepRecords) await archiveJournal(user, gid, group.name);
  await remove(r(`journals/${gid}`));
  await update(r(''), { [`groups/${gid}`]: null, [`taken/${gid}`]: null, [`invites/${gid}`]: null });
  await update(r(`users/${user.uid}`), { groupId: null, role: null });
  return students;
}

/** Owner hands the group (with its journal) to a deputy; optionally stays as a deputy. */
export async function transferGroup(user, profile, newOwnerUid, { stayAsDeputy }) {
  const gid = profile.groupId;
  const members = (await read(`journals/${gid}/members`)) || {};
  // Journal member list first, while we still own the group.
  await update(r(`journals/${gid}/members`), {
    [newOwnerUid]: { name: members[newOwnerUid]?.name || 'староста', role: 'owner' },
    [user.uid]: stayAsDeputy ? { name: profile.name, role: 'deputy' } : null,
  });

  const gu = { owner: newOwnerUid, [`deputies/${newOwnerUid}`]: null };
  if (stayAsDeputy) gu[`deputies/${user.uid}`] = 'transfer';
  await update(r(`groups/${gid}`), gu);
  await update(r(`users/${user.uid}`), stayAsDeputy ? { role: 'deputy' } : { groupId: null, role: null });
}

/** Deputy leaves the group. */
export async function leaveAsDeputy(user, profile) {
  const gid = profile.groupId;
  await remove(r(`journals/${gid}/members/${user.uid}`)).catch(() => {});
  await remove(r(`groups/${gid}/deputies/${user.uid}`)).catch(() => {});
  await update(r(`users/${user.uid}`), { groupId: null, role: null });
}

/** Admin: free a group that was claimed by mistake or by a stranger. */
export async function adminReleaseGroup(gid) {
  await remove(r(`journals/${gid}`));
  await update(r(''), { [`groups/${gid}`]: null, [`taken/${gid}`]: null, [`invites/${gid}`]: null });
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
