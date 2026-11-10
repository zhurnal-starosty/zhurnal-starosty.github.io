// Entry point: auth state, routing, page shell.
import { auth, onAuthStateChanged, read, r, set, signOut } from './fb.js';
import { $, esc, toast } from './ui.js';
import { loadMembership } from './group.js';
import * as authView from './views/auth.js';
import * as setupView from './views/setup.js';
import * as journalView from './views/journal.js';
import * as settingsView from './views/settings.js';

/** Shared app state, passed to every view. */
export const state = {
  user: null,      // Firebase user
  profile: null,   // /users/{uid}
  group: null,     // /groups/{gid} (only when the user is a member)
  isAdmin: false,
  carryStudents: null, // students list carried over when changing group
  pendingName: null,   // name typed in the registration form, used to create the profile
};

const TABS = [
  { route: 'journal', label: 'Журнал', view: journalView },
  { route: 'settings', label: 'Налаштування', view: settingsView },
];

const mainEl = $('#main');
const navEl = $('#nav');
const userEl = $('#userBox');
const groupTagEl = $('#groupTag');
let currentView = null;

function route() {
  return (location.hash.replace(/^#\/?/, '') || '').split('?')[0];
}

export function go(path) {
  if (route() === path) render(); else location.hash = '#/' + path;
}

/** Reload profile + membership (after claiming/leaving a group, renaming…). */
export async function refreshProfile() {
  const { user } = state;
  state.profile = (await read(`users/${user.uid}`)) || null;
  if (!state.profile) {
    // First sign-in right after registration (name comes from the form), or the profile write failed earlier.
    const name = (state.pendingName || user.displayName || (user.email || 'Староста').split('@')[0]).slice(0, 80);
    state.profile = { name, createdAt: Date.now() };
    if (user.email) state.profile.email = user.email;
    state.pendingName = null;
    await set(r(`users/${user.uid}`), state.profile);
  }
  state.group = await loadMembership(user, state.profile);
  if (state.profile.groupId && !state.group) {
    // Removed by the starosta or freed by an admin.
    const { update } = await import('./fb.js');
    await update(r(`users/${user.uid}`), { groupId: null, role: null });
    state.profile.groupId = null; state.profile.role = null;
    toast('Доступ до групи закрито. Оберіть групу заново.', 'error');
  }
  renderShell();
}

function renderShell() {
  const { user, profile, group } = state;
  const inside = !!(user && profile && group);
  document.body.classList.toggle('signed-out', !user);

  groupTagEl.textContent = inside
    ? `${group.name} · ${profile.role === 'owner' ? 'староста' : 'заступник'}`
    : '';

  userEl.innerHTML = user
    ? `<span class="who">${esc(profile?.name || user.email)}</span><button class="ghost-btn" id="logoutBtn">Вийти</button>`
    : '';
  $('#logoutBtn')?.addEventListener('click', () => signOut(auth));

  const cur = route();
  navEl.innerHTML = inside
    ? TABS.map(t => `<a class="tab-btn${cur === t.route ? ' active' : ''}" href="#/${t.route}">${t.label}</a>`).join('')
    : '';
  navEl.parentElement.hidden = !inside;
}

async function render() {
  currentView?.unmount?.();
  currentView = null;
  const { user, profile, group } = state;
  let view, path = route();

  if (!user) {
    view = authView;
    if (!['login', 'register', 'reset'].includes(path)) { history.replaceState(null, '', '#/login'); path = 'login'; }
  } else if (!profile) {
    mainEl.innerHTML = '<div class="loading-page">Завантаження…</div>';
    return;
  } else if (!group) {
    view = setupView;
    if (path !== 'setup') history.replaceState(null, '', '#/setup');
    path = 'setup';
  } else {
    const tab = TABS.find(t => t.route === path);
    if (!tab) { history.replaceState(null, '', '#/journal'); path = 'journal'; }
    view = (tab || TABS[0]).view;
  }
  renderShell();
  currentView = view;
  mainEl.innerHTML = '';
  await view.mount(mainEl, { state, go, refreshProfile, path });
}

window.addEventListener('hashchange', render);

onAuthStateChanged(auth, async user => {
  state.user = user;
  state.profile = null;
  state.group = null;
  state.isAdmin = false;
  if (user) {
    render(); // shows "loading"
    try {
      await refreshProfile();
      state.isAdmin = !!(await read(`admins/${user.uid}`).catch(() => null));
    } catch (e) {
      console.error(e);
      renderShell();
      mainEl.innerHTML = `<div class="empty-state"><h2>Не вдалося завантажити профіль</h2>
        <p>${esc(e.message)}</p><p><button class="primary-btn" onclick="location.reload()">Спробувати ще раз</button></p></div>`;
      return;
    }
  }
  render();
});
