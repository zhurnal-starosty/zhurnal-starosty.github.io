// Email action links (Firebase "custom action URL" points here): ?mode=resetPassword&oobCode=...
import { auth, verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword, errorText } from '../fb.js';
import { $, esc, busy } from '../ui.js';

export async function mount(root, { params }) {
  const mode = params.get('mode');
  const code = params.get('oobCode');
  const done = () => history.replaceState(null, '', location.pathname + '#/journal');

  if (mode !== 'resetPassword' || !code) {
    root.innerHTML = `<div class="auth-page"><div class="auth-form"><h1>Посилання недійсне</h1>
      <p><a href="${location.pathname}#/login">Перейти до входу</a></p></div></div>`;
    return;
  }

  root.innerHTML = '<div class="loading-page">Перевірка посилання…</div>';
  let email;
  try {
    email = await verifyPasswordResetCode(auth, code);
  } catch (e) {
    root.innerHTML = `<div class="auth-page"><div class="auth-form"><h1>Відновлення пароля</h1>
      <p class="form-error">${esc(errorText(e))}</p>
      <p><a href="${location.pathname}#/reset">Надіслати новий лист</a></p></div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="auth-page">
      <form class="auth-form" novalidate>
        <h1>Новий пароль</h1>
        <p class="muted">${esc(email)}</p>
        <label>Новий пароль<input name="password" type="password" autocomplete="new-password" minlength="6" required></label>
        <label>Повторіть пароль<input name="password2" type="password" autocomplete="new-password" minlength="6" required></label>
        <div class="form-error" role="alert"></div>
        <button class="primary-btn" type="submit">Зберегти і увійти</button>
      </form>
    </div>`;
  const form = $('form', root);
  $('input', form).focus();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    busy($('button', form), async () => {
      if (v.password.length < 6) throw { code: 'auth/weak-password' };
      if (v.password !== v.password2) throw { message: 'Паролі не збігаються.' };
      await confirmPasswordReset(auth, code, v.password);
      done();
      await signInWithEmailAndPassword(auth, email, v.password); // the auth listener takes it from here
    }, $('.form-error', form));
  });
}
