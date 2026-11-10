# Лист «Відновлення пароля»

**Шаблони листів для цього проєкту заблоковані Firebase.** У консолі (Authentication → Templates) показується
«Email template updates are currently unavailable for this project», а API відповідає `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`.
Тому ні текст, ні тему, ні адресу посилання змінити не можна.

Що використовується:
- сайт задає `auth.languageCode = 'uk'` → Firebase надсилає свій вбудований український переклад;
- у тексті підставляється **Public-facing name** проєкту (`%APP_NAME%`): «скинути пароль додатка …», «Команда …».
  Його треба тримати = `Журнал старости` (Project settings → General → Public settings, або Google Cloud → Auth → Branding → App name);
- посилання веде на стандартну сторінку Firebase `pi26-7.firebaseapp.com/__/auth/action` (українською, бо `lang=uk`).

`js/views/action.js` (сторінка «Новий пароль» на сайті) залишено на випадок, якщо шаблони колись розблокують:
тоді досить задати «Customize action URL» = `https://zhurnal-starosty.github.io/`.

## Чому лист потрапляє в спам

Лист надсилає Google від `noreply@pi26-7.firebaseapp.com` — спільного домену, з якого шлють листи тисячі проєктів.
Гарантовано у «Вхідні» листи потрапляють лише з власного домену (SPF/DKIM), а він платний.
Користувачу допомагає один раз натиснути «Не спам» — Gmail запам’ятовує відправника.
