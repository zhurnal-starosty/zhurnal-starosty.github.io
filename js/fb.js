// Firebase (modular SDK from gstatic, no build step).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, updatePassword, reauthenticateWithCredential,
  EmailAuthProvider, verifyPasswordResetCode, confirmPasswordReset,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, onValue, off, push,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAqj1dBvByK6Vwnz0nEaHyHVyKY8h1pIvU',
  authDomain: 'pi26-7.firebaseapp.com',
  databaseURL: 'https://pi26-7-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'pi26-7',
  storageBucket: 'pi26-7.firebasestorage.app',
  messagingSenderId: '788681929939',
  appId: '1:788681929939:web:14eab5dadaed91d4cb9026',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Built-in Ukrainian email text. Custom templates are locked for this project by Firebase
// ("Email template updates are currently unavailable"), so the translation is the best option. See docs/EMAIL.md.
auth.languageCode = 'uk';
export const db = getDatabase(app);

export const r = path => (path ? ref(db, path) : ref(db)); // '' = database root (multi-path updates)
export const read = async path => (await get(r(path))).val();

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  verifyPasswordResetCode, confirmPasswordReset,
  set, update, remove, onValue, off, push,
};

/** Human-readable (Ukrainian) message for Firebase errors. */
export function errorText(err) {
  const code = err?.code || '';
  const map = {
    'auth/email-already-in-use': 'Цей email уже зареєстровано. Спробуйте увійти.',
    'auth/invalid-email': 'Неправильний формат email.',
    'auth/weak-password': 'Пароль занадто простий — мінімум 6 символів.',
    'auth/invalid-credential': 'Неправильний email або пароль.',
    'auth/wrong-password': 'Неправильний пароль.',
    'auth/user-not-found': 'Користувача з таким email не знайдено.',
    'auth/missing-password': 'Введіть пароль.',
    'auth/too-many-requests': 'Забагато спроб. Зачекайте кілька хвилин.',
    'auth/network-request-failed': 'Немає з’єднання з інтернетом.',
    'auth/requires-recent-login': 'Для цієї дії потрібно ввести поточний пароль ще раз.',
    'auth/expired-action-code': 'Посилання застаріло. Запросіть новий лист для відновлення пароля.',
    'auth/invalid-action-code': 'Посилання недійсне або вже використане. Запросіть новий лист.',
    'PERMISSION_DENIED': 'Немає доступу.',
  };
  if (map[code]) return map[code];
  if (/permission[_ ]denied/i.test(err?.message || '')) return map.PERMISSION_DENIED;
  if (!code && err?.message) return err.message; // our own validation messages
  return 'Помилка: ' + (err?.message || err);
}
