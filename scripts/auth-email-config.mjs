// Sets the Firebase Auth password-reset email (Ukrainian text, sender name) and points the
// action link to the site (js/views/action.js handles ?mode=resetPassword&oobCode=...).
//   node auth-email-config.mjs [--dry-run]
import { accessToken } from './firebase.mjs';

const PROJECT = 'pi26-7';
const SITE = 'https://zhurnal-starosty.github.io/';

const resetPasswordTemplate = {
  senderLocalPart: 'noreply',
  senderDisplayName: 'Журнал старости',
  replyTo: 'noreply',
  subject: 'Відновлення пароля в Журналі старости',
  bodyFormat: 'HTML',
  body: [
    '<p>Вітаємо!</p>',
    '<p>Для акаунта %EMAIL% у Журналі старости надійшов запит на відновлення пароля.</p>',
    '<p><a href="%LINK%">Встановити новий пароль</a></p>',
    '<p>Посилання діє одну годину. Якщо ви не робили цього запиту, просто проігноруйте лист: пароль не зміниться.</p>',
  ].join('\n'),
};

const body = {
  notification: {
    sendEmail: { resetPasswordTemplate, callbackUri: SITE },
    defaultLocale: 'uk',
  },
};
const mask = ['notification.sendEmail.resetPasswordTemplate', 'notification.sendEmail.callbackUri', 'notification.defaultLocale'];

if (process.argv.includes('--dry-run')) { console.log(JSON.stringify(body, null, 1)); process.exit(0); }

const t = await accessToken();
const res = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=${mask.join(',')}`, {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ' + t, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json();
if (!res.ok) { console.error('FAILED', res.status, JSON.stringify(j.error || j)); process.exit(1); }
const n = j.notification;
console.log('ok:', n.sendEmail.resetPasswordTemplate.subject, '|', n.sendEmail.resetPasswordTemplate.senderDisplayName, '|', n.sendEmail.callbackUri, '|', n.defaultLocale);
