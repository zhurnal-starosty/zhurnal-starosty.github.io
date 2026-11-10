// Settings: profile name, password, group (deputies + invite code), change group.
import {
  auth, read, r, update, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from '../fb.js';
import { $, esc, busy, toast, makeCode } from '../ui.js';
import { leaveGroup, setInvite, removeDeputy } from '../group.js';

export async function mount(host, { state, refreshProfile, go }) {
  // Fresh container on every (re)mount so old event listeners are dropped with it.
  const root = document.createElement('div');
  host.replaceChildren(root);
  const remount = () => mount(host, { state, refreshProfile, go });
  const { user, profile, group } = state;
  const gid = profile.groupId;
  const isOwner = profile.role === 'owner';

  let invite = null, members = {};
  if (isOwner) {
    [invite, members] = await Promise.all([read(`invites/${gid}`), read(`journals/${gid}/members`)]);
    members ||= {};
  }
  const deputyIds = Object.keys(group.deputies || {});

  root.innerHTML = `
    <div class="settings">
      <section class="card">
        <h3>Профіль</h3>
        <form class="row-form" data-form="name">
          <label>Ім’я та прізвище<input name="name" required maxlength="80" value="${esc(profile.name)}"></label>
          <button class="primary-btn" type="submit">Зберегти</button>
        </form>
        <div class="form-error" data-err="name"></div>
        <p class="hint">Email: <b>${esc(user.email)}</b></p>
      </section>

      <section class="card">
        <h3>Пароль</h3>
        <form class="row-form" data-form="password">
          <label>Поточний пароль<input name="current" type="password" autocomplete="current-password" required></label>
          <label>Новий пароль<input name="next" type="password" autocomplete="new-password" minlength="6" required></label>
          <button class="primary-btn" type="submit">Змінити</button>
        </form>
        <div class="form-error" data-err="password"></div>
      </section>

      <section class="card">
        <h3>Група</h3>
        <p>Ви ${isOwner ? 'староста' : 'заступник старости'} групи <b>${esc(group.name)}</b>.</p>
        ${isOwner ? `
          <h4>Заступники</h4>
          <p class="hint">Заступник може так само відмічати присутність і редагувати список студентів.
            Дайте йому код: він реєструється, обирає групу ${esc(group.name)} і вводить код.</p>
          <div class="invite">
            ${invite?.code
              ? `<code class="invite-code">${esc(invite.code)}</code>
                 <button class="ghost-btn dark" data-act="copy">Копіювати</button>
                 <button class="ghost-btn dark" data-act="new-code">Новий код</button>`
              : `<button class="primary-btn" data-act="new-code">Створити код запрошення</button>`}
          </div>
          ${invite?.code ? '<p class="hint">«Новий код» робить старий недійсним (уже підключені заступники залишаються).</p>' : ''}
          <ul class="deputies">
            ${deputyIds.length ? deputyIds.map(uid => `
              <li><span>${esc(members[uid]?.name || 'заступник')}</span>
                <button class="ghost-btn dark danger" data-act="remove-deputy" data-uid="${esc(uid)}">Відключити</button></li>`).join('')
              : '<li class="hint">Заступників немає.</li>'}
          </ul>` : ''}

        <h4>${isOwner ? 'Змінити групу' : 'Вийти з групи'}</h4>
        <div class="leave-box">
          <button class="ghost-btn dark danger" data-act="leave-ask">${isOwner ? 'Змінити групу…' : 'Вийти з групи…'}</button>
        </div>
      </section>
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
        toast('Ім’я збережено');
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

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'copy') {
      navigator.clipboard?.writeText(invite.code).then(() => toast('Код скопійовано'), () => toast(invite.code));
    }
    if (act === 'new-code') {
      busy(btn, async () => { await setInvite(gid, makeCode()); toast('Код створено'); remount(); });
    }
    if (act === 'remove-deputy') {
      const name = btn.previousElementSibling.textContent;
      if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = `Точно відключити ${name}?`; return; }
      busy(btn, async () => {
        await removeDeputy(gid, btn.dataset.uid);
        await refreshProfile();
        toast(`${name} більше не має доступу`);
        remount();
      });
    }
    if (act === 'leave-ask') {
      $('.leave-box', root).innerHTML = isOwner ? `
        <div class="warn">
          <p><b>Увага.</b> Група ${esc(group.name)} звільниться, її журнал (усі відмітки) буде видалено,
            ${deputyIds.length ? 'заступники втратять доступ, ' : ''}і ви зможете обрати іншу групу.</p>
          <label class="check"><input type="checkbox" name="carry" checked> Перенести список студентів у нову групу</label>
          <div class="form-error"></div>
          <button class="primary-btn danger" data-act="leave">Звільнити групу ${esc(group.name)}</button>
          <button class="ghost-btn dark" data-act="leave-cancel">Скасувати</button>
        </div>` : `
        <div class="warn">
          <p>Ви втратите доступ до журналу групи ${esc(group.name)}. Повернутися можна з новим кодом від старости.</p>
          <div class="form-error"></div>
          <button class="primary-btn danger" data-act="leave">Вийти з групи</button>
          <button class="ghost-btn dark" data-act="leave-cancel">Скасувати</button>
        </div>`;
    }
    if (act === 'leave-cancel') remount();
    if (act === 'leave') {
      const carry = $('input[name=carry]', root)?.checked;
      busy(btn, async () => {
        const students = await leaveGroup(user, profile);
        state.carryStudents = carry && students ? students : null;
        await refreshProfile();
        go('setup');
      }, $('.leave-box .form-error', root));
    }
  });
}
