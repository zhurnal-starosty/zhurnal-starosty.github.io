// Settings: profile name, password, group (deputies, invite code, hand over / leave), saved records.
import {
  auth, read, r, update, remove, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from '../fb.js';
import { $, esc, busy, toast, makeCode } from '../ui.js';
import { setInvite, removeDeputy, releaseGroup, transferGroup, leaveAsDeputy } from '../group.js';

const fmtDate = ts => new Date(ts).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

export async function mount(host, { state, refreshProfile, go }) {
  // Fresh container on every (re)mount so old event listeners are dropped with it.
  const root = document.createElement('div');
  host.replaceChildren(root);
  const remount = () => mount(host, { state, refreshProfile, go });
  const { user, profile, group } = state;
  const gid = profile.groupId;
  const isOwner = profile.role === 'owner';

  const [invite, membersRaw, archives] = await Promise.all([
    isOwner ? read(`invites/${gid}`) : null,
    read(`journals/${gid}/members`).catch(() => null),
    read(`archives/${user.uid}`).catch(() => null),
  ]);
  const members = membersRaw || {};
  const deputyIds = Object.keys(group.deputies || {});
  const deputyName = uid => members[uid]?.name || 'Заступник';

  root.innerHTML = `
    <div class="settings">
      <section class="panel">
        <h2>Профіль</h2>
        <form class="row-form" data-form="name">
          <label>Ім’я та прізвище<input name="name" required maxlength="80" value="${esc(profile.name)}"></label>
          <button class="primary-btn" type="submit">Зберегти</button>
        </form>
        <div class="form-error" data-err="name"></div>
        <p class="muted">Email: ${esc(user.email || '')}</p>
      </section>

      <section class="panel">
        <h2>Пароль</h2>
        <form class="row-form" data-form="password">
          <label>Поточний пароль<input name="current" type="password" autocomplete="current-password" required></label>
          <label>Новий пароль<input name="next" type="password" autocomplete="new-password" minlength="6" required></label>
          <button class="primary-btn" type="submit">Змінити</button>
        </form>
        <div class="form-error" data-err="password"></div>
      </section>

      <section class="panel">
        <h2>Група ${esc(group.name)}</h2>
        <p>Ви ${isOwner ? 'староста' : 'заступник старости'}.</p>
        ${isOwner ? `
          <h3>Заступники</h3>
          <p class="muted">Заступник бачить і редагує журнал. Щоб підключитися, він обирає групу ${esc(group.name)} і вводить код.</p>
          <div class="invite">
            ${invite?.code
              ? `<span class="invite-code">${esc(invite.code)}</span>
                 <button class="secondary-btn" data-act="copy">Копіювати</button>
                 <button class="secondary-btn" data-act="new-code">Новий код</button>`
              : `<button class="secondary-btn" data-act="new-code">Створити код</button>`}
          </div>
          <table class="simple-table deputies">
            ${deputyIds.length ? deputyIds.map(uid => `
              <tr><td>${esc(deputyName(uid))}</td>
                <td class="right"><button class="secondary-btn danger" data-act="remove-deputy" data-uid="${esc(uid)}" data-name="${esc(deputyName(uid))}">Відключити</button></td></tr>`).join('')
              : '<tr><td class="muted">Заступників немає</td></tr>'}
          </table>` : ''}

        <h3>${isOwner ? 'Змінити групу або передати старосту' : 'Вийти з групи'}</h3>
        <div class="leave-box">
          <button class="secondary-btn" data-act="leave-ask">${isOwner ? 'Змінити групу' : 'Вийти з групи'}</button>
        </div>
      </section>

      ${archives ? `
      <section class="panel">
        <h2>Збережені записи</h2>
        <p class="muted">Відновлюються, коли ви знову стаєте старостою цієї групи.</p>
        <table class="simple-table">
          ${Object.entries(archives).map(([agid, a]) => `
            <tr><td>${esc(a.name)}</td><td class="muted">збережено ${fmtDate(a.savedAt)}</td>
              <td class="right"><button class="secondary-btn danger" data-act="del-archive" data-gid="${esc(agid)}" data-name="${esc(a.name)}">Видалити</button></td></tr>`).join('')}
        </table>
      </section>` : ''}
    </div>`;

  const errOf = k => $(`[data-err="${k}"]`, root);

  root.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    const v = Object.fromEntries(new FormData(form));
    const btn = $('button[type=submit]', form);
    if (form.dataset.form === 'name') {
      busy(btn, async () => {
        const name = v.name.trim().replace(/\s+/g, ' ');
        if (name.length < 2) throw { message: 'Вкажіть ім’я та прізвище.' };
        await update(r(`users/${user.uid}`), { name });
        await update(r(`journals/${gid}/members/${user.uid}`), { name });
        updateProfile(user, { displayName: name }).catch(() => {});
        await refreshProfile();
        toast('Збережено');
      }, errOf('name'));
    }
    if (form.dataset.form === 'password') {
      busy(btn, async () => {
        if (v.next.length < 6) throw { code: 'auth/weak-password' };
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, v.current));
        await updatePassword(auth.currentUser, v.next);
        form.reset();
        toast('Пароль змінено');
      }, errOf('password'));
    }
  });

  // "Are you sure?" on the same button: first click asks, second click does it.
  const confirmed = (btn, question) => {
    if (btn.dataset.confirm === '1') return true;
    btn.dataset.confirm = '1';
    btn.textContent = question;
    return false;
  };

  root.addEventListener('change', e => {
    if (e.target.name === 'mode') {
      const mode = e.target.value;
      $('.opt-transfer', root)?.toggleAttribute('hidden', mode !== 'transfer');
      $('.opt-release', root)?.toggleAttribute('hidden', mode !== 'release');
      $('[data-act="leave"]', root).textContent = mode === 'transfer' ? 'Передати' : `Звільнити групу ${group.name}`;
    }
  });

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'copy') {
      navigator.clipboard?.writeText(invite.code).then(() => toast('Код скопійовано'), () => toast(invite.code));
    }
    if (act === 'new-code') {
      busy(btn, async () => { await setInvite(gid, makeCode()); remount(); });
    }
    if (act === 'remove-deputy') {
      if (!confirmed(btn, `Відключити ${btn.dataset.name}?`)) return;
      busy(btn, async () => {
        await removeDeputy(gid, btn.dataset.uid);
        await refreshProfile();
        toast(`${btn.dataset.name} більше не має доступу`);
        remount();
      });
    }
    if (act === 'del-archive') {
      if (!confirmed(btn, 'Видалити назавжди?')) return;
      busy(btn, async () => { await remove(r(`archives/${user.uid}/${btn.dataset.gid}`)); remount(); });
    }
    if (act === 'leave-ask') {
      $('.leave-box', root).innerHTML = isOwner ? `
        <div class="leave-form">
          ${deputyIds.length ? `
            <label class="radio"><input type="radio" name="mode" value="transfer"> Передати старосту заступнику</label>
            <div class="opt-transfer sub-options" hidden>
              <select name="newOwner">${deputyIds.map(uid => `<option value="${esc(uid)}">${esc(deputyName(uid))}</option>`).join('')}</select>
              <label class="check"><input type="checkbox" name="stay" checked> Залишитися заступником</label>
              <p class="muted">Журнал і всі записи залишаються в групі.</p>
            </div>` : ''}
          <label class="radio"><input type="radio" name="mode" value="release" checked> Звільнити групу</label>
          <div class="opt-release sub-options">
            <label class="radio"><input type="radio" name="records" value="keep" checked> Зберегти записи в моєму акаунті</label>
            <label class="radio"><input type="radio" name="records" value="delete"> Видалити записи</label>
            <label class="check"><input type="checkbox" name="carry" checked> Перенести список студентів у нову групу</label>
            ${deputyIds.length ? '<p class="muted">Заступники втратять доступ.</p>' : ''}
          </div>
          <div class="form-error"></div>
          <div class="btn-row">
            <button class="primary-btn danger" data-act="leave">Звільнити групу ${esc(group.name)}</button>
            <button class="secondary-btn" data-act="leave-cancel">Скасувати</button>
          </div>
        </div>` : `
        <div class="leave-form">
          <p>Ви втратите доступ до журналу групи ${esc(group.name)}.</p>
          <div class="form-error"></div>
          <div class="btn-row">
            <button class="primary-btn danger" data-act="leave">Вийти з групи</button>
            <button class="secondary-btn" data-act="leave-cancel">Скасувати</button>
          </div>
        </div>`;
    }
    if (act === 'leave-cancel') remount();
    if (act === 'leave') {
      const f = name => $(`[name="${name}"]`, root);
      const mode = isOwner ? $('[name="mode"]:checked', root).value : 'deputy';
      busy(btn, async () => {
        if (mode === 'transfer') {
          const newOwner = f('newOwner').value;
          await transferGroup(user, profile, newOwner, { stayAsDeputy: f('stay').checked });
          await refreshProfile();
          toast(`Старостою групи став ${deputyName(newOwner)}`);
          go(state.group ? 'journal' : 'setup');
        } else if (mode === 'release') {
          const keepRecords = $('[name="records"]:checked', root).value === 'keep';
          const students = await releaseGroup(user, profile, group, { keepRecords });
          state.carryStudents = f('carry').checked && students ? students : null;
          await refreshProfile();
          go('setup');
        } else {
          await leaveAsDeputy(user, profile);
          await refreshProfile();
          go('setup');
        }
      }, $('.leave-box .form-error', root));
    }
  });
}
