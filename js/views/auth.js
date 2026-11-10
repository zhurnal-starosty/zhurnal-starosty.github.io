// Login / registration / password reset (no app content is visible without signing in).
import {
  auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
} from '../fb.js';
import { $, esc, busy } from '../ui.js';

export function mount(root, { state, path }) {
  const mode = path; // login | register | reset
  const lastEmail = sessionStorage.getItem('lastEmail') || '';

  const forms = {
    login: `
      <h2>Вхід</h2>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required></label>
      <div class="form-error" role="alert"></div>
      <button class="primary-btn" type="submit">Увійти</button>
      <div class="auth-links">
        <a href="#/register">Створити акаунт</a>
        <a href="#/reset">Забули пароль?</a>
      </div>`,
    register: `
      <h2>Реєстрація старости</h2>
      <label>Ім’я та прізвище<input name="name" autocomplete="name" required maxlength="80" placeholder="Андрієнко Артьом"></label>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <label>Пароль<input name="password" type="password" autocomplete="new-password" required minlength="6" placeholder="мінімум 6 символів"></label>
      <label>Пароль ще раз<input name="password2" type="password" autocomplete="new-password" required minlength="6"></label>
      <div class="form-error" role="alert"></div>
      <button class="primary-btn" type="submit">Зареєструватися</button>
      <p class="hint">Наступним кроком оберете свою групу з розкладу ХНУРЕ.</p>
      <div class="auth-links"><a href="#/login">Уже маю акаунт</a></div>`,
    reset: `
      <h2>Відновлення пароля</h2>
      <p class="hint">Надішлемо на пошту посилання для створення нового пароля.</p>
      <label>Email<input name="email" type="email" autocomplete="email" required value="${esc(lastEmail)}"></label>
      <div class="form-error" role="alert"></div>
      <div class="form-ok" role="status"></div>
      <button class="primary-btn" type="submit">Надіслати посилання</button>
      <div class="auth-links"><a href="#/login">Назад до входу</a></div>`,
  };

  root.innerHTML = `
    <div class="auth-page">
      <div class="auth-intro">
        <h1>Журнал старости</h1>
        <p>Облік присутності для старост груп ХНУРЕ. Розклад підтягується з CIST автоматично.</p>
      </div>
      <form class="card auth-card" novalidate>${forms[mode]}</form>
    </div>`;

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
        updateProfile(cred.user, { displayName: name }).catch(() => {});
      } else {
        await sendPasswordResetEmail(auth, email);
        $('.form-ok', form).textContent = `Лист надіслано на ${email}. Перевірте також «Спам».`;
      }
    }, err);
  });
}
