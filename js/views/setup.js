// Group picker: faculty tabs -> course columns -> groups (like cist.nure.ua), plus search.
// A free group can be claimed as starosta; a taken one can be joined as deputy with a code.
import { read } from '../fb.js';
import { $, esc, busy, toast } from '../ui.js';
import { buildTree, searchGroups, facultyLabel } from '../catalog.js';
import { claimGroup, joinAsDeputy } from '../group.js';

const LS_FAC = 'setup.faculty';

export async function mount(root, { state, refreshProfile, go }) {
  root.innerHTML = '<div class="loading-page">Завантаження списку груп…</div>';
  let catalog, taken;
  try {
    [catalog, taken] = await Promise.all([read('catalog'), read('taken')]);
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><h2>Не вдалося завантажити список груп</h2><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (!catalog?.faculties) {
    root.innerHTML = '<div class="empty-state"><h2>Список груп ще не завантажено</h2><p>Він оновлюється з CIST автоматично. Спробуйте за кілька хвилин.</p></div>';
    return;
  }
  taken ||= {};
  const tree = buildTree(catalog);
  let facId = localStorage.getItem(LS_FAC);
  if (!tree.some(f => f.id === facId)) facId = tree[0].id;
  let selected = null; // {id, name}
  const carry = state.carryStudents ? Object.keys(state.carryStudents).length : 0;

  root.innerHTML = `
    <div class="setup">
      <div class="setup-head">
        <h2>Оберіть свою групу</h2>
        <p class="hint">Вітаємо, ${esc(state.profile.name)}! Знайдіть групу, старостою якої ви є.
          Розклад для неї підтягнеться з CIST автоматично.${carry ? ` Список студентів (${carry}) буде перенесено в нову групу.` : ''}</p>
        <input class="search" type="search" placeholder="Пошук: напр. ПІ-26-7" autocomplete="off">
      </div>
      <section class="picked" hidden></section>
      <div class="search-results" hidden></div>
      <nav class="fac-tabs"></nav>
      <div class="fac-title"></div>
      <div class="courses"></div>
    </div>`;

  const searchEl = $('.search', root);
  const resultsEl = $('.search-results', root);
  const tabsEl = $('.fac-tabs', root);
  const titleEl = $('.fac-title', root);
  const coursesEl = $('.courses', root);
  const pickedEl = $('.picked', root);

  const groupLink = g => `<button type="button" class="grp${taken[g.id] ? ' taken' : ''}${selected?.id === g.id ? ' sel' : ''}"
      data-id="${esc(g.id)}" data-name="${esc(g.name)}" title="${taken[g.id] ? 'у групи вже є староста' : ''}">${esc(g.name)}</button>`;

  function renderTabs() {
    tabsEl.innerHTML = tree.map(f => `<button type="button" class="fac${f.id === facId ? ' active' : ''}" data-fac="${f.id}">${esc(f.abbr)}</button>`).join('');
  }

  function renderCourses() {
    const fac = tree.find(f => f.id === facId);
    titleEl.textContent = fac.name;
    const courseNums = Object.keys(fac.courses).map(Number).sort((a, b) => (a || 99) - (b || 99));
    coursesEl.innerHTML = courseNums.map(c => `
      <div class="course">
        <div class="course-h">${c ? c + '-й курс' : 'Інші'}</div>
        ${Object.entries(fac.courses[c]).sort(([a], [b]) => a.localeCompare(b, 'uk')).map(([prefix, groups]) => `
          <div class="prefix">${esc(prefix)}</div>
          <div class="grp-list">${groups.map(groupLink).join('')}</div>`).join('')}
      </div>`).join('');
  }

  function renderSearch() {
    const q = searchEl.value.trim();
    const found = searchGroups(catalog, q);
    resultsEl.hidden = !q;
    tabsEl.hidden = titleEl.hidden = coursesEl.hidden = !!q;
    if (!q) return;
    resultsEl.innerHTML = found.length
      ? found.map(g => {
          const f = catalog.faculties[g.fac];
          return `<div class="sr-row">${groupLink(g)}<span class="sr-fac">${esc(f ? facultyLabel(f) : '')}</span></div>`;
        }).join('')
      : '<p class="hint">Нічого не знайдено.</p>';
  }

  function renderPicked() {
    pickedEl.hidden = !selected;
    if (!selected) return;
    const isTaken = !!taken[selected.id];
    pickedEl.innerHTML = `
      <div class="picked-h">
        <div><div class="picked-name">${esc(selected.name)}</div>
          <div class="hint">${isTaken ? 'У цієї групи вже є староста.' : 'Група вільна.'}</div></div>
        <button type="button" class="ghost-btn dark" data-act="cancel">Скасувати</button>
      </div>
      ${isTaken ? `
        <form class="deputy-form">
          <label>Ви заступник старости? Введіть код запрошення від старости
            <input name="code" placeholder="XXXX-XXXX" autocomplete="off" maxlength="12" required></label>
          <div class="form-error" role="alert"></div>
          <button class="primary-btn" type="submit">Приєднатися як заступник</button>
          <p class="hint">Якщо групу зайняли помилково чи без вашого відома — зверніться до адміністратора сайту.</p>
        </form>` : `
        <div class="form-error" role="alert"></div>
        <button type="button" class="primary-btn" data-act="claim">Я староста групи ${esc(selected.name)}</button>`}`;
    $('input[name=code]', pickedEl)?.focus();
  }

  function rerenderGroups() { renderCourses(); renderSearch(); renderPicked(); }

  root.addEventListener('click', e => {
    const fac = e.target.closest('.fac');
    if (fac) {
      facId = fac.dataset.fac;
      localStorage.setItem(LS_FAC, facId);
      renderTabs(); renderCourses();
      return;
    }
    const grp = e.target.closest('.grp');
    if (grp) {
      selected = { id: grp.dataset.id, name: grp.dataset.name };
      rerenderGroups();
      pickedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') { selected = null; rerenderGroups(); }
    if (act === 'claim') {
      const btn = e.target.closest('button');
      busy(btn, async () => {
        try {
          await claimGroup(state.user, state.profile, selected.id, selected.name, state.carryStudents);
        } catch (err) {
          if (err.code === 'taken') {
            taken = (await read('taken')) || {};
            rerenderGroups();
            throw { message: 'Цю групу щойно зайняв інший староста.' };
          }
          throw err;
        }
        state.carryStudents = null;
        await refreshProfile();
        toast(`Готово! Ви староста групи ${selected.name}.`);
        go('journal');
      }, $('.form-error', pickedEl));
    }
  });

  root.addEventListener('submit', e => {
    if (!e.target.matches('.deputy-form')) return;
    e.preventDefault();
    const code = new FormData(e.target).get('code');
    busy($('button[type=submit]', e.target), async () => {
      try {
        await joinAsDeputy(state.user, state.profile, selected.id, code);
      } catch (err) {
        if (err.code === 'bad-code') throw { message: 'Неправильний код. Попросіть у старости актуальний код.' };
        throw err;
      }
      await refreshProfile();
      toast(`Готово! Ви заступник старости групи ${selected.name}.`);
      go('journal');
    }, $('.form-error', e.target));
  });

  searchEl.addEventListener('input', renderSearch);
  renderTabs();
  renderCourses();
}
