// Login / registration / password reset (no app content is visible without signing in).
import {
  auth, r, update, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
} from '../fb.js';
import { $, esc, busy } from '../ui.js';

export function mount(root, { state, path }) {
  const mode = path; // login | register | reset
  const lastEmail = sessionStorage.getItem('lastEmail') || '';

  const forms = {
    login: `
      <h1>Вхід</h1>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error" role="alert"></div>
      <button class="primary-btn" type="submit">Увійти</button>
      <div class="auth-links">
        <a href="#/register">Реєстрація</a>
        <a href="#/reset">Забули пароль?</a>
      </div>`,
    register: `
      <h1>Реєстрація</h1>
      <label>Ім’я та прізвище<input name="name" autocomplete="name" required maxlength="80"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <label>Пароль<input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
      <label>Повторіть пароль<input name="password2" type="password" autocomplete="new-password" required minlength="6"></label>
      <div class="form-error" role="alert"></div>
      <button class="primary-btn" type="submit">Зареєструватися</button>
      <div class="auth-links"><a href="#/login">Вхід</a></div>`,
    reset: `
      <h1>Відновлення пароля</h1>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <div class="form-error" role="alert"></div>
      <div class="form-ok" role="status"></div>
      <button class="primary-btn" type="submit">Надіслати посилання</button>
      <div class="auth-links"><a href="#/login">Вхід</a></div>`,
  };

  root.innerHTML = `<div class="auth-page"><form class="auth-form" novalidate>${forms[mode]}</form></div>`;

  const form = $('form', root);
  const err = $('.form-error', form);
  const btn = $('button[type=submit]', form);
  $('input', form).focus();

  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const email = (v.email || '').trim();
    sessionStorage.setItem('lastEmail', email);

    busy(btn, async () => {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, v.password);
      } else if (mode === 'register') {
        const name = v.name.trim().replace(/\s+/g, ' ');
        if (name.length < 2) throw { message: 'Вкажіть ім’я та прізвище.' };
        if (v.password.length < 6) throw { code: 'auth/weak-password' };
        if (v.password !== v.password2) throw { message: 'Паролі не збігаються.' };
        state.pendingName = name;
        const cred = await createUserWithEmailAndPassword(auth, email, v.password);
        // The auth listener may have already created the profile; make sure it has the typed name.
        await update(r(`users/${cred.user.uid}`), { name, email });
        if (state.profile && state.user?.uid === cred.user.uid) state.profile.name = name;
        updateProfile(cred.user, { displayName: name }).catch(() => {});
      } else {
        await sendPasswordResetEmail(auth, email);
        $('.form-ok', form).textContent = `Лист надіслано на ${email}.`;
      }
    }, err);
  });
}
