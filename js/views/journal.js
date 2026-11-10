// Journal (stage 2 preview): the group's week timetable synced from CIST.
// Attendance marks come in stage 4.
import { r, onValue, off } from '../fb.js';
import { $, esc } from '../ui.js';

const DAYS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', 'П’ятниця', 'Субота'];
const TYPE_NAMES = { Лк: 'лекція', Пз: 'практичне', Лб: 'лабораторна', Конс: 'консультація', Екз: 'екзамен', Зал: 'залік' };

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dm = s => s.slice(8, 10) + '.' + s.slice(5, 7);
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

let unsub = null;

export function mount(root, { state }) {
  const gid = state.profile.groupId;
  let monday = mondayOf(new Date());
  let schedule = undefined; // undefined = loading, null = not synced yet

  function render() {
    const from = iso(monday), to = iso(addDays(monday, 6));
    const head = `
      <div class="week-head">
        <button class="nav-btn" data-nav="-1" aria-label="Попередній тиждень">←</button>
        <div class="week-label"><b>${dm(from)} – ${dm(to)}.${to.slice(0, 4)}</b>
          ${iso(mondayOf(new Date())) === from ? '<span class="pill">цей тиждень</span>' : '<button class="link-btn" data-nav="0">до поточного</button>'}</div>
        <button class="nav-btn" data-nav="1" aria-label="Наступний тиждень">→</button>
      </div>`;

    if (schedule === undefined) { root.innerHTML = head + '<div class="loading-page">Завантаження розкладу…</div>'; return; }
    if (!schedule?.events) {
      root.innerHTML = head + `<div class="empty-state"><h2>Розклад ще не завантажено</h2>
        <p>Для нової групи розклад з CIST з’являється протягом ~10–20 хвилин після реєстрації, далі оновлюється щогодини.
        Сторінка оновиться сама.</p></div>`;
      return;
    }

    const events = Object.entries(schedule.events)
      .filter(([, e]) => e.date >= from && e.date <= to)
      .sort(([, a], [, b]) => (a.date + a.start).localeCompare(b.date + b.start));
    const subjects = schedule.subjects || {};
    const byDay = {};
    for (const [id, e] of events) (byDay[e.date] ||= []).push([id, e]);

    const days = Object.keys(byDay).map(date => {
      const d = new Date(date + 'T12:00:00');
      return `
        <section class="day${date === iso(new Date()) ? ' today' : ''}">
          <h3>${DAYS[d.getDay()]} <span>${dm(date)}</span></h3>
          <table class="pairs">${byDay[date].map(([, e]) => {
            const s = subjects[e.subject] || {};
            const teachers = s.types?.[e.type]?.teachers?.join(', ') || '';
            return `<tr class="${e.removed ? 'removed' : ''}">
              <td class="p-num">${e.pair || ''}</td>
              <td class="p-time">${e.start}<br>${e.end}</td>
              <td class="p-subj"><b>${esc(e.subject)}</b> <span class="type t-${esc(e.type)}">${esc(TYPE_NAMES[e.type] || e.type)}</span>
                <div class="p-full">${esc(s.name || '')}${teachers ? ' · ' + esc(teachers) : ''}</div></td>
            </tr>`;
          }).join('')}</table>
        </section>`;
    }).join('');

    const checked = schedule.checkedAt ? new Date(schedule.checkedAt).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    root.innerHTML = head + (days || '<div class="empty-state"><h2>Пар цього тижня немає</h2></div>') +
      `<p class="hint sync-note">Розклад з CIST · перевірено ${checked}. Відмітки присутності з’являться на наступному етапі.</p>`;
  }

  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (!nav) return;
    const n = Number(nav.dataset.nav);
    monday = n === 0 ? mondayOf(new Date()) : addDays(monday, 7 * n);
    render();
  });

  const refSched = r(`schedules/${gid}`);
  onValue(refSched, snap => { schedule = snap.val(); render(); }, err => {
    root.innerHTML = `<div class="empty-state"><h2>Немає доступу до розкладу</h2><p>${esc(err.message)}</p></div>`;
  });
  unsub = () => off(refSched);
  render();
}

export function unmount() { unsub?.(); unsub = null; }
