// Journal: weekly register, students × pairs (from CIST). Click a cell: empty -> був -> не був -> empty.
// Right click / long press (or click on an excused mark) opens a small panel for «поважна причина» + comment.
import { r, onValue, off, update } from '../fb.js';
import { $, esc, toast } from '../ui.js';
import { sortedStudents } from '../students.js';

const DAY_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dm = s => s.slice(8, 10) + '.' + s.slice(5, 7);
const mondayOf = date => { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function weekTitle(mon) {
  const sun = addDays(mon, 6);
  if (mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]} ${sun.getFullYear()}`;
  const y = mon.getFullYear() === sun.getFullYear() ? '' : ' ' + mon.getFullYear();
  return `${mon.getDate()} ${MONTHS_GEN[mon.getMonth()]}${y} – ${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]} ${sun.getFullYear()}`;
}

/** Stored mark -> {s: 0 none | 1 present | 2 absent, excused, note} */
export function readMark(v) {
  if (v === 1 || v === 2) return { s: v, excused: false, note: '' };
  if (v && typeof v === 'object') return { s: v.s || 2, excused: !!v.excused, note: v.note || '' };
  return { s: 0, excused: false, note: '' };
}
const writeMark = m => (m.s === 0 ? null : m.s === 2 && (m.excused || m.note) ? { s: 2, excused: !!m.excused, note: m.note || null } : m.s);

let unsubs = [];

export function mount(root, { state }) {
  const gid = state.profile.groupId;
  let monday = mondayOf(new Date());
  let schedule, students, marks; // undefined = loading
  let panel = null;               // {eid, sid}

  function weekEvents() {
    const from = iso(monday), to = iso(addDays(monday, 6));
    return Object.entries(schedule?.events || {})
      .filter(([, e]) => e.date >= from && e.date <= to)
      .sort(([, a], [, b]) => (a.date + a.start).localeCompare(b.date + b.start));
  }

  function cellHtml(eid, sid, ri, ci) {
    const m = readMark(marks?.[eid]?.[sid]);
    const cls = m.s === 1 ? 'm-present' : m.s === 2 ? (m.excused ? 'm-excused' : 'm-absent') : 'm-none';
    const sign = m.s === 1 ? '✓' : m.s === 2 ? (m.excused ? 'п' : '✗') : '';
    const title = m.s === 2 ? (m.excused ? 'Поважна причина' : 'Не був') + (m.note ? ': ' + m.note : '') : m.s === 1 ? 'Був' : '';
    return `<td class="mark ${cls}${m.note ? ' has-note' : ''}" data-eid="${esc(eid)}" data-sid="${esc(sid)}" data-r="${ri}" data-c="${ci}" title="${esc(title)}">${sign}</td>`;
  }

  function render() {
    const nav = `
      <div class="week-bar">
        <button class="secondary-btn" data-nav="-1">Попередній тиждень</button>
        <span class="week-title">${weekTitle(monday)}</span>
        <button class="secondary-btn" data-nav="1">Наступний тиждень</button>
        ${iso(mondayOf(new Date())) !== iso(monday) ? '<button class="text-btn" data-nav="0">Поточний тиждень</button>' : ''}
        <span class="spacer"></span>
        <span class="muted sync-info">${schedule?.checkedAt ? 'Розклад з CIST оновлено ' + fmtChecked(schedule.checkedAt) : ''}</span>
      </div>`;

    if (schedule === undefined || students === undefined || marks === undefined) { root.innerHTML = nav + '<div class="loading-page">Завантаження…</div>'; return; }
    if (!schedule?.events) {
      root.innerHTML = nav + `<div class="empty-state"><h2>Розклад ще не завантажено</h2>
        <p>Для нової групи розклад з’являється протягом 10–20 хвилин, далі оновлюється щогодини.</p></div>`;
      return;
    }
    const list = sortedStudents(students);
    if (!list.length) {
      root.innerHTML = nav + `<div class="empty-state"><h2>Немає студентів</h2><p><a href="#/students">Додати список студентів</a></p></div>`;
      return;
    }
    const events = weekEvents();
    if (!events.length) { root.innerHTML = nav + '<div class="empty-state"><h2>Цього тижня пар немає</h2></div>'; return; }

    const today = iso(new Date());
    const subjects = schedule.subjects || {};
    const days = [];
    for (const [eid, e] of events) {
      let d = days[days.length - 1];
      if (!d || d.date !== e.date) days.push(d = { date: e.date, events: [] });
      d.events.push([eid, e]);
    }
    const dayClass = date => (date === today ? ' today' : '');

    const head1 = days.map(d => {
      const wd = DAY_SHORT[new Date(d.date + 'T12:00:00').getDay()];
      return `<th class="day${dayClass(d.date)}" colspan="${d.events.length}">${wd} ${dm(d.date)}${d.date === today ? ' <span class="today-tag">сьогодні</span>' : ''}</th>`;
    }).join('');
    const head2 = days.flatMap(d => d.events.map(([eid, e]) => {
      const s = subjects[e.subject] || {};
      const teachers = s.types?.[e.type]?.teachers?.join(', ') || '';
      const tip = [s.name, e.type, `${e.start}–${e.end}`, teachers, e.removed ? 'пару знято з розкладу' : ''].filter(Boolean).join('\n');
      return `<th class="pair${dayClass(d.date)}${e.removed ? ' removed' : ''}" title="${esc(tip)}">
        <span class="p-no">${e.pair || ''}</span> ${esc(e.subject)} <span class="p-type">${esc(e.type)}</span></th>`;
    })).join('');
    const head3 = days.flatMap(d => d.events.map(([eid]) =>
      `<th class="quick${dayClass(d.date)}"><button class="text-btn" data-all="${esc(eid)}">усі присутні</button></th>`)).join('');

    const body = list.map((s, i) => {
      let absent = 0, excused = 0, ci = 0;
      const cells = days.flatMap(d => d.events.map(([eid]) => {
        const m = readMark(marks?.[eid]?.[s.id]);
        if (m.s === 2) { absent++; if (m.excused) excused++; }
        return cellHtml(eid, s.id, i, ci++).replace('class="mark', `class="mark${dayClass(d.date)}`);
      })).join('');
      return `<tr><td class="num">${i + 1}</td><td class="name">${esc(s.name)}</td>${cells}
        <td class="total${absent ? ' has-absent' : ''}">${absent}</td><td class="total${excused ? ' has-excused' : ''}">${excused}</td></tr>`;
    }).join('');

    root.innerHTML = nav + `
      <div class="table-wrap register-wrap">
        <table class="register">
          <thead>
            <tr><th class="num" rowspan="3">№</th><th class="name" rowspan="3">Прізвище та ім’я</th>${head1}
              <th class="total-h" colspan="2">За тиждень</th></tr>
            <tr>${head2}<th class="total-h sub" rowspan="2">Пропуски</th><th class="total-h sub" rowspan="2">з них поважні</th></tr>
            <tr>${head3}</tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="legend">
        <span><i class="lg m-present">✓</i> був</span>
        <span><i class="lg m-absent">✗</i> не був</span>
        <span><i class="lg m-excused">п</i> поважна причина</span>
        <span class="muted">Клік змінює відмітку; затисніть і протягніть — заповнити кілька клітинок; Ctrl+Z — скасувати.
          Права кнопка миші або довге натискання — поважна причина й коментар.</span>
      </div>`;
    if (panel) openPanel(panel.eid, panel.sid);
  }

  function fmtChecked(ts) {
    const d = new Date(ts), now = new Date();
    const t = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    return iso(d) === iso(now) ? `сьогодні о ${t}` : `${d.toLocaleDateString('uk-UA')} о ${t}`;
  }

  /* ---------- writes with undo / redo ---------- */
  // Every change goes through applyChanges({ 'eid/sid': value|null }) so Ctrl+Z can restore the previous values.
  const undoStack = [], redoStack = [];
  const rawMark = (eid, sid) => marks?.[eid]?.[sid] ?? null;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  function writeRaw(changes) {
    return update(r(`journals/${gid}/marks`), changes).catch(e => toast(e.message, 'error'));
  }

  function applyChanges(changes) {
    const before = {}, after = {};
    for (const [path, value] of Object.entries(changes)) {
      const [eid, sid] = path.split('/');
      const old = rawMark(eid, sid);
      if (same(old, value)) continue;
      before[path] = old;
      after[path] = value ?? null;
    }
    if (!Object.keys(after).length) return;
    undoStack.push({ before, after });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    writeRaw(after);
  }

  function undo() {
    const op = undoStack.pop();
    if (!op) { toast('Немає дій для скасування'); return; }
    redoStack.push(op);
    writeRaw(op.before);
    const n = Object.keys(op.before).length;
    toast(n > 1 ? `Скасовано (${n} клітинок)` : 'Скасовано');
  }

  function redo() {
    const op = redoStack.pop();
    if (!op) return;
    undoStack.push(op);
    writeRaw(op.after);
    toast('Повернуто');
  }

  const saveMark = (eid, sid, m) => applyChanges({ [`${eid}/${sid}`]: writeMark(m) });

  function cycle(td) {
    const { eid, sid } = td.dataset;
    const m = readMark(rawMark(eid, sid));
    if (m.excused || m.note) { openPanel(eid, sid); return; }
    saveMark(eid, sid, { s: (m.s + 1) % 3 });
  }

  /* ---------- drag to fill (like Excel) ---------- */
  // Press on a cell, drag over others (any direction): on release every cell in the rectangle
  // gets the value of the first cell. Mouse/pen only; on touch screens dragging scrolls the table.
  let drag = null, suppressClick = false;
  const cellsIn = (r0, c0, r1, c1) => {
    const [ra, rb] = [Math.min(r0, r1), Math.max(r0, r1)], [ca, cb] = [Math.min(c0, c1), Math.max(c0, c1)];
    return [...root.querySelectorAll('td.mark')].filter(td => {
      const rr = +td.dataset.r, cc = +td.dataset.c;
      return rr >= ra && rr <= rb && cc >= ca && cc <= cb;
    });
  };
  function paintDrag() {
    root.querySelectorAll('td.fill-sel').forEach(td => td.classList.remove('fill-sel'));
    if (drag?.moved) cellsIn(drag.r0, drag.c0, drag.r1, drag.c1).forEach(td => td.classList.add('fill-sel'));
  }

  root.addEventListener('pointerdown', e => {
    const td = e.target.closest('td.mark');
    if (!td || e.button !== 0 || e.pointerType === 'touch') return;
    e.preventDefault(); // no text selection while dragging
    const { eid, sid } = td.dataset;
    drag = { r0: +td.dataset.r, c0: +td.dataset.c, r1: +td.dataset.r, c1: +td.dataset.c, value: rawMark(eid, sid), moved: false };
  });
  const onMove = e => {
    if (!drag) return;
    if (!(e.buttons & 1)) { drag = null; paintDrag(); return; }
    const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td.mark');
    if (!td || !root.contains(td)) return;
    const r1 = +td.dataset.r, c1 = +td.dataset.c;
    if (r1 === drag.r1 && c1 === drag.c1) return;
    drag.r1 = r1; drag.c1 = c1;
    drag.moved = drag.moved || r1 !== drag.r0 || c1 !== drag.c0;
    paintDrag();
  };
  const onUp = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    paintDrag();
    if (!d.moved) return; // plain click: handled by the click listener
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const value = d.value == null ? null : JSON.parse(JSON.stringify(d.value));
    const changes = {};
    for (const td of cellsIn(d.r0, d.c0, d.r1, d.c1)) changes[`${td.dataset.eid}/${td.dataset.sid}`] = value;
    applyChanges(changes);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  unsubs.push(() => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); });

  // Ctrl+Z / Ctrl+Y (by physical key, so it works with the Ukrainian layout too)
  const onKey = e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(); }
  };
  document.addEventListener('keydown', onKey);
  unsubs.push(() => document.removeEventListener('keydown', onKey));

  /* ---------- excused panel (inline, anchored to the cell) ---------- */
  function closePanel() { panel = null; $('.mark-panel', root)?.remove(); }

  function openPanel(eid, sid) {
    $('.mark-panel', root)?.remove();
    const td = $(`td.mark[data-eid="${CSS.escape(eid)}"][data-sid="${CSS.escape(sid)}"]`, root);
    if (!td) { panel = null; return; }
    panel = { eid, sid };
    const m = readMark(marks?.[eid]?.[sid]);
    const st = students[sid]?.name || '';
    const choice = m.s === 1 ? 'present' : m.s === 2 ? (m.excused ? 'excused' : 'absent') : 'none';
    const box = document.createElement('div');
    box.className = 'mark-panel';
    box.innerHTML = `
      <div class="mp-title">${esc(st)}</div>
      <label class="radio"><input type="radio" name="mp" value="present" ${choice === 'present' ? 'checked' : ''}> Був</label>
      <label class="radio"><input type="radio" name="mp" value="absent" ${choice === 'absent' ? 'checked' : ''}> Не був</label>
      <label class="radio"><input type="radio" name="mp" value="excused" ${choice === 'excused' ? 'checked' : ''}> Не був, поважна причина</label>
      <label class="mp-note">Коментар<input name="note" maxlength="200" value="${esc(m.note)}"></label>
      <div class="btn-row">
        <button class="primary-btn small" data-mp="save">Зберегти</button>
        <button class="secondary-btn small" data-mp="clear">Очистити</button>
        <button class="text-btn" data-mp="close">Скасувати</button>
      </div>`;
    root.appendChild(box);
    // Fixed to the viewport so the table's scroll box doesn't clip it; closes on scroll.
    const tr = td.getBoundingClientRect();
    const left = Math.min(Math.max(8, tr.left), window.innerWidth - box.offsetWidth - 8);
    let top = tr.bottom + 2;
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, tr.top - box.offsetHeight - 2);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    $('input[name=note]', box).focus();
  }

  root.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const n = Number(nav.dataset.nav);
      monday = n === 0 ? mondayOf(new Date()) : addDays(monday, 7 * n);
      closePanel(); render(); return;
    }
    const mp = e.target.closest('[data-mp]');
    if (mp) {
      const { eid, sid } = panel;
      const box = $('.mark-panel', root);
      if (mp.dataset.mp === 'close') { closePanel(); return; }
      if (mp.dataset.mp === 'clear') { closePanel(); saveMark(eid, sid, { s: 0 }); return; }
      const v = $('input[name=mp]:checked', box)?.value || 'none';
      const note = $('input[name=note]', box).value.trim();
      const m = v === 'present' ? { s: 1 } : v === 'absent' ? { s: 2, note } : v === 'excused' ? { s: 2, excused: true, note } : { s: 0 };
      closePanel(); saveMark(eid, sid, m); return;
    }
    if (e.target.closest('.mark-panel')) return;
    const all = e.target.closest('[data-all]');
    if (all) {
      const eid = all.dataset.all;
      const u = {};
      for (const sid of Object.keys(students || {})) if (!rawMark(eid, sid)) u[`${eid}/${sid}`] = 1;
      applyChanges(u);
      return;
    }
    const td = e.target.closest('td.mark');
    if (td) { if (suppressClick) return; if (panel) closePanel(); cycle(td); return; }
    if (panel) closePanel();
  });

  const onScroll = e => { if (panel && !e.target.closest?.('.mark-panel')) closePanel(); };
  window.addEventListener('scroll', onScroll, true);
  unsubs.push(() => window.removeEventListener('scroll', onScroll, true));

  root.addEventListener('contextmenu', e => {
    const td = e.target.closest('td.mark');
    if (!td) return;
    e.preventDefault();
    openPanel(td.dataset.eid, td.dataset.sid);
  });

  // Long press on touch screens
  let pressTimer = null, pressed = false;
  root.addEventListener('touchstart', e => {
    const td = e.target.closest('td.mark');
    if (!td) return;
    pressed = false;
    pressTimer = setTimeout(() => { pressed = true; openPanel(td.dataset.eid, td.dataset.sid); }, 500);
  }, { passive: true });
  const cancelPress = e => { clearTimeout(pressTimer); if (pressed && e.type === 'touchend') { e.preventDefault(); pressed = false; } };
  root.addEventListener('touchend', cancelPress);
  root.addEventListener('touchmove', cancelPress, { passive: true });

  root.addEventListener('keydown', e => {
    if (!panel) return;
    if (e.key === 'Escape') closePanel();
    if (e.key === 'Enter' && e.target.closest('.mark-panel')) $('[data-mp=save]', root)?.click();
  });

  /* ---------- live data ---------- */
  const subs = [
    [r(`schedules/${gid}`), v => { schedule = v; }],
    [r(`journals/${gid}/students`), v => { students = v || {}; }],
    [r(`journals/${gid}/marks`), v => { marks = v || {}; }],
  ];
  for (const [ref, setV] of subs) {
    onValue(ref, snap => {
      setV(snap.val());
      // Typing a comment must not be interrupted by someone else's mark.
      if (panel && document.activeElement?.closest('.mark-panel')) return;
      render();
    }, err => { root.innerHTML = `<div class="empty-state"><h2>Немає доступу</h2><p>${esc(err.message)}</p></div>`; });
    unsubs.push(() => off(ref));
  }
  render();
}

export function unmount() { unsubs.forEach(f => f()); unsubs = []; }
