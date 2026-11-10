// "Студенти": inline-editable list (no popups), reorder by drag or up/down, bulk import with preview.
import { r, onValue, off, update, push, remove } from '../fb.js';
import { $, $$, esc, busy, toast } from '../ui.js';
import { sortedStudents, cleanTg, cleanPhone, formatPhone, parseList, fileToText } from '../students.js';

let unsub = null;

export function mount(root, { state }) {
  const gid = state.profile.groupId;
  const base = `journals/${gid}/students`;
  let list = null;          // sorted array
  let editing = null;       // student id being edited, or 'new'
  let importOpen = false;
  let importRows = [];
  let pendingRemote = false;

  const tgLink = tg => tg ? `<a href="https://t.me/${esc(tg)}" target="_blank" rel="noopener">@${esc(tg)}</a>` : '';
  const phoneLink = p => p ? `<a href="tel:${esc(p)}">${esc(formatPhone(p))}</a>` : '';

  function rowView(s, i) {
    return `<tr data-id="${esc(s.id)}" draggable="false">
      <td class="handle" title="Перетягніть, щоб змінити порядок" aria-label="Перетягнути"></td>
      <td class="num">${i + 1}</td>
      <td class="name" data-act="edit">${esc(s.name)}</td>
      <td>${tgLink(s.tg)}</td>
      <td class="nowrap">${phoneLink(s.phone)}</td>
      <td class="note">${esc(s.note || '')}</td>
      <td class="actions">
        <button class="text-btn" data-act="up" ${i === 0 ? 'disabled' : ''}>вгору</button>
        <button class="text-btn" data-act="down" ${i === list.length - 1 ? 'disabled' : ''}>вниз</button>
        <button class="text-btn" data-act="edit">змінити</button>
        <button class="text-btn danger" data-act="del">видалити</button>
      </td>
    </tr>`;
  }

  function rowEdit(s, i) {
    return `<tr data-id="${esc(s.id)}" class="editing">
      <td class="handle"></td>
      <td class="num">${s.id === 'new' ? '' : i + 1}</td>
      <td><input name="name" value="${esc(s.name || '')}" maxlength="80" aria-label="Прізвище та ім’я"></td>
      <td><input name="tg" value="${s.tg ? '@' + esc(s.tg) : ''}" maxlength="40" aria-label="Telegram"></td>
      <td><input name="phone" type="tel" value="${esc(formatPhone(s.phone || ''))}" maxlength="20" aria-label="Телефон"></td>
      <td><input name="note" value="${esc(s.note || '')}" maxlength="200" aria-label="Примітка"></td>
      <td class="actions">
        <button class="primary-btn small" data-act="save">Зберегти</button>
        <button class="text-btn" data-act="cancel">скасувати</button>
      </td>
    </tr>`;
  }

  function importPanel() {
    if (!importOpen) return '';
    const fresh = importRows.filter(x => !x.exists);
    return `
      <section class="panel import-panel">
        <h2>Імпорт списку</h2>
        <label>Один студент на рядок; Telegram і телефон можна дописати в тому ж рядку
          <textarea name="importText" rows="8" spellcheck="false"></textarea></label>
        <div class="btn-row">
          <label class="file-btn secondary-btn">Завантажити Excel або CSV<input type="file" accept=".xlsx,.xls,.csv,.txt" hidden></label>
        </div>
        ${importRows.length ? `
          <table class="register-lite preview">
            <thead><tr><th>Стан</th><th>Прізвище та ім’я</th><th>Telegram</th><th>Телефон</th><th>Примітка</th></tr></thead>
            <tbody>${importRows.map(x => `<tr class="${x.exists ? 'dim' : ''}">
              <td>${x.exists ? 'вже є' : 'новий'}</td><td>${esc(x.name)}</td><td>${x.tg ? '@' + esc(x.tg) : ''}</td>
              <td class="nowrap">${esc(formatPhone(x.phone))}</td><td>${esc(x.note)}</td></tr>`).join('')}</tbody>
          </table>` : ''}
        <div class="form-error" data-err="import"></div>
        <div class="btn-row">
          <button class="primary-btn" data-act="import-apply" ${fresh.length ? '' : 'disabled'}>${fresh.length ? `Додати ${fresh.length}` : 'Додати'}</button>
          <button class="secondary-btn" data-act="import-close">Скасувати</button>
        </div>
      </section>`;
  }

  function render() {
    if (list === null) { root.innerHTML = '<div class="loading-page">Завантаження…</div>'; return; }
    const textBefore = $('[name=importText]', root)?.value;
    const rows = list.map((s, i) => (editing === s.id ? rowEdit(s, i) : rowView(s, i)));
    if (editing === 'new') rows.push(rowEdit({ id: 'new' }, list.length));

    root.innerHTML = `
      <div class="page-head">
        <h1>Студенти<span class="count">${list.length}</span></h1>
        <div class="btn-row">
          <button class="primary-btn" data-act="add">Додати студента</button>
          <button class="secondary-btn" data-act="import-open">Імпорт списку</button>
          <button class="secondary-btn" data-act="sort" ${list.length > 1 ? '' : 'disabled'}>За алфавітом</button>
        </div>
      </div>
      ${importPanel()}
      ${list.length || editing === 'new' ? `
        <div class="table-wrap">
          <table class="register-lite students">
            <thead><tr><th class="handle"></th><th class="num">№</th><th>Прізвище та ім’я</th><th>Telegram</th><th>Телефон</th><th>Примітка</th><th></th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
        <div class="form-error" data-err="row"></div>`
      : (importOpen ? '' : `<div class="empty-state"><h2>Список порожній</h2>
          <p>Додайте студентів по одному або вставте весь список через «Імпорт списку».</p></div>`)}`;

    if (textBefore != null && $('[name=importText]', root)) $('[name=importText]', root).value = textBefore;
    const first = $('tr.editing input', root);
    if (first) { first.focus(); first.setSelectionRange(first.value.length, first.value.length); }
    pendingRemote = false;
  }

  /* ---------- writes ---------- */
  const nextOrder = () => (list.length ? Math.max(...list.map(s => s.order ?? 0)) + 1 : 0);

  async function saveRow(tr) {
    const v = Object.fromEntries($$('input', tr).map(i => [i.name, i.value.trim()]));
    const name = v.name.replace(/\s+/g, ' ');
    if (!name) throw { message: 'Вкажіть прізвище та ім’я.' };
    const tg = v.tg ? cleanTg(v.tg) : '';
    if (v.tg && !tg) throw { message: 'Telegram: вкажіть нік, наприклад @nickname.' };
    const phone = v.phone ? cleanPhone(v.phone) : '';
    if (v.phone && !phone) throw { message: 'Неправильний номер телефону.' };
    const data = { name, tg: tg || null, phone: phone || null, note: v.note || null };
    if (editing === 'new') await push(r(base), { ...data, order: nextOrder() });
    else await update(r(`${base}/${editing}`), data);
    editing = null;
  }

  async function writeOrder(ids) {
    const u = {};
    ids.forEach((id, i) => { u[`${id}/order`] = i; });
    await update(r(base), u);
  }

  function move(id, delta) {
    const ids = list.map(s => s.id);
    const i = ids.indexOf(id), j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    writeOrder(ids).catch(e => toast(e.message, 'error'));
  }

  /* ---------- events ---------- */
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const tr = btn.closest('tr');
    const id = tr?.dataset.id;
    const errRow = $('[data-err=row]', root);

    if (act === 'add') { editing = 'new'; render(); $('tr.editing', root)?.scrollIntoView({ block: 'nearest' }); }
    if (act === 'edit' && editing !== id) { editing = id; render(); }
    if (act === 'cancel') { editing = null; render(); }
    if (act === 'save') busy(btn, async () => { await saveRow(tr); render(); }, errRow);
    if (act === 'up') move(id, -1);
    if (act === 'down') move(id, 1);
    if (act === 'del') {
      const s = list.find(x => x.id === id);
      if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.textContent = 'точно видалити?'; return; }
      busy(btn, async () => {
        await remove(r(`${base}/${id}`));
        toast(`${s.name} видалено зі списку`);
      }, errRow);
    }
    if (act === 'sort') {
      const coll = new Intl.Collator('uk', { sensitivity: 'base' });
      writeOrder([...list].sort((a, b) => coll.compare(a.name, b.name)).map(s => s.id)).catch(err => toast(err.message, 'error'));
    }
    if (act === 'import-open') { importOpen = true; importRows = []; render(); $('[name=importText]', root)?.focus(); }
    if (act === 'import-close') { importOpen = false; importRows = []; render(); }
    if (act === 'import-apply') {
      busy(btn, async () => {
        const fresh = importRows.filter(x => !x.exists);
        let order = nextOrder();
        const u = {};
        for (const x of fresh) {
          const key = push(r(base)).key;
          u[key] = { name: x.name, tg: x.tg || null, phone: x.phone || null, note: x.note || null, order: order++ };
        }
        await update(r(base), u);
        importOpen = false; importRows = [];
        render();
        toast(`Додано студентів: ${fresh.length}`);
      }, $('[data-err=import]', root));
    }
  });

  root.addEventListener('keydown', e => {
    const tr = e.target.closest('tr.editing');
    if (!tr) return;
    if (e.key === 'Enter') { e.preventDefault(); $('[data-act=save]', tr).click(); }
    if (e.key === 'Escape') { editing = null; render(); }
  });

  let parseTimer = null;
  root.addEventListener('input', e => {
    if (e.target.name !== 'importText') return;
    clearTimeout(parseTimer);
    parseTimer = setTimeout(() => {
      importRows = parseList(e.target.value, list);
      const pos = e.target.selectionStart;
      render();
      const ta = $('[name=importText]', root);
      ta.focus(); ta.setSelectionRange(pos, pos);
    }, 300);
  });

  root.addEventListener('change', async e => {
    if (e.target.type !== 'file' || !e.target.files[0]) return;
    try {
      const text = await fileToText(e.target.files[0]);
      importRows = parseList(text, list);
      render();
      $('[name=importText]', root).value = text;
      if (!importRows.length) $('[data-err=import]', root).textContent = 'У файлі не знайдено імен.';
    } catch (err) {
      $('[data-err=import]', root).textContent = err.message;
    }
  });

  /* ---------- drag to reorder (by the handle) ---------- */
  let dragId = null;
  root.addEventListener('pointerdown', e => {
    const h = e.target.closest('td.handle');
    const tr = h?.closest('tr');
    if (tr && !tr.classList.contains('editing')) tr.draggable = true;
  });
  root.addEventListener('dragstart', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr?.draggable) return;
    dragId = tr.dataset.id;
    tr.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', e => {
    if (!dragId) return;
    const tr = e.target.closest('tbody tr[data-id]');
    if (!tr || tr.dataset.id === dragId) return;
    e.preventDefault();
    const dragged = $(`tr[data-id="${CSS.escape(dragId)}"]`, root);
    const after = e.clientY > tr.getBoundingClientRect().top + tr.offsetHeight / 2;
    tr.parentNode.insertBefore(dragged, after ? tr.nextSibling : tr);
  });
  root.addEventListener('dragend', () => {
    if (!dragId) return;
    const ids = $$('tbody tr[data-id]', root).map(tr => tr.dataset.id).filter(id => id !== 'new');
    dragId = null;
    writeOrder(ids).catch(err => toast(err.message, 'error'));
  });

  /* ---------- live data ---------- */
  const ref = r(base);
  onValue(ref, snap => {
    list = sortedStudents(snap.val());
    if (editing && editing !== 'new' && !list.some(s => s.id === editing)) editing = null;
    if (editing) { pendingRemote = true; return; } // don't wipe the row being edited
    render();
  }, err => { root.innerHTML = `<div class="empty-state"><h2>Немає доступу</h2><p>${esc(err.message)}</p></div>`; });
  unsub = () => off(ref);
  render();
}

export function unmount() { unsub?.(); unsub = null; }
