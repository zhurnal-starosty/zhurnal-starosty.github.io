// Export: attendance for a period (today / week / month / semester / custom) to Excel, HTML or CSV.
import { read } from '../fb.js';
import { $, $$, esc, busy, toast } from '../ui.js';
import { sortedStudents } from '../students.js';
import { readMark } from './journal.js';

const MONTHS = ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dmy = s => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const dm = s => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const SIGN = { 1: '+', 2: '−', 3: '(−)' }; // + був, − не був, (−) не був з поважної причини
const DAY_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function presetRange(preset, semester) {
  const now = new Date(), today = iso(now);
  if (preset === 'today') return [today, today];
  if (preset === 'week') {
    const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return [iso(mon), iso(sun)];
  }
  if (preset === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
  if (preset === 'semester' && semester) return [semester.from, semester.to];
  return null;
}

/** Builds all export tables for [from, to] and the chosen subjects. */
export function buildReport({ schedule, students, marks, groupName, from, to, subjects, withExcused = true }) {
  const list = sortedStudents(students);
  const subj = schedule?.subjects || {};
  const events = Object.entries(schedule?.events || {})
    .filter(([id, e]) => e.date >= from && e.date <= to && subjects.has(e.subject) && (!e.removed || marks[id]))
    .sort(([, a], [, b]) => (a.date + a.start).localeCompare(b.date + b.start));

  // withExcused=false: an excused absence is just «не був» (−), no separate column or comments.
  const code = (eid, sid) => { const m = readMark(marks[eid]?.[sid]); return m.s === 2 && m.excused && withExcused ? 3 : m.s; };

  // Matrix: students × pairs. Two header rows: the day (once per day) and the pair itself.
  const pairHead = events.map(([, e]) => `${e.pair || ''} ${e.subject} ${e.type}`.trim().replace(/\s+/g, ' '));
  const dayLabel = date => `${DAY_SHORT[new Date(date + 'T12:00:00').getDay()]} ${dm(date)}`;
  const days = []; // [{label, start, span}]
  events.forEach(([, e], i) => {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.span++;
    else days.push({ date: e.date, label: dayLabel(e.date), start: i, span: 1 });
  });
  const dayHead = events.map((_, i) => days.find(d => d.start === i)?.label || '');
  const matrix = list.map((s, i) => {
    let present = 0, absent = 0, excused = 0;
    const cells = events.map(([eid]) => {
      const c = code(eid, s.id);
      if (c === 1) present++; else if (c === 2) absent++; else if (c === 3) { absent++; excused++; }
      return SIGN[c] || '';
    });
    return { n: i + 1, name: s.name, cells, present, absent, excused };
  });

  // Summary per student
  const summary = matrix.map(r => {
    const marked = r.present + r.absent;
    return { n: r.n, name: r.name, marked, present: r.present, absent: r.absent, excused: r.excused,
      pct: marked ? Math.round((r.present / marked) * 100) : null };
  });

  // Absences per subject (не був, including excused)
  const subjList = [...new Set(events.map(([, e]) => e.subject))].sort((a, b) => a.localeCompare(b, 'uk'));
  const bySubject = list.map((s, i) => ({
    n: i + 1, name: s.name,
    counts: subjList.map(sj => events.filter(([eid, e]) => e.subject === sj && code(eid, s.id) >= 2).length),
  }));

  // Comments
  const comments = [];
  for (const [eid, e] of events) for (const s of list) {
    const m = readMark(marks[eid]?.[s.id]);
    if (withExcused && m.s === 2 && (m.excused || m.note)) comments.push({ date: dmy(e.date), pair: `${e.pair || ''} ${e.subject} ${e.type}`.trim(), name: s.name, kind: m.excused ? 'поважна' : 'не був', note: m.note });
  }

  const title = `Відвідування ${groupName}, ${from === to ? dmy(from) : `${dmy(from)} – ${dmy(to)}`}`;
  const legend = withExcused ? 'Позначення: + був, − не був, (−) не був з поважної причини' : 'Позначення: + був, − не був';
  const totalsHead = withExcused ? ['Був', 'Не був', 'з них поважні'] : ['Був', 'Не був'];
  const totals = r => (withExcused ? [r.present, r.absent, r.excused] : [r.present, r.absent]);
  const summaryHead = ['№', 'Прізвище та ім’я', 'Пар з відмітками', ...totalsHead, 'Присутність, %'];
  const summaryRow = r => [r.n, r.name, r.marked, ...totals(r), r.pct ?? ''];
  return { title, events, pairHead, dayHead, days, matrix, summary, subjList, subjNames: subjList.map(sj => subj[sj]?.name || sj),
    bySubject, comments, withExcused, legend, totalsHead, totals, summaryHead, summaryRow };
}

let xlsxPromise = null;
function loadXLSX() {
  xlsxPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error('Не вдалося завантажити модуль Excel')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const safeName = s => s.replace(/[\\/:*?"<>|]+/g, '-');

async function exportXlsx(rep) {
  const XLSX = await loadXLSX();
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths, merges) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    if (merges) ws['!merges'] = merges;
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  // Rows 3-4 (index 2-3) are the header: day above, pair below; №, name and totals span both rows.
  const nP = rep.pairHead.length, H = 2, tail = 2 + nP;
  const merges = [
    { s: { r: H, c: 0 }, e: { r: H + 1, c: 0 } },
    { s: { r: H, c: 1 }, e: { r: H + 1, c: 1 } },
    ...rep.totalsHead.map((_, k) => ({ s: { r: H, c: tail + k }, e: { r: H + 1, c: tail + k } })),
    ...rep.days.filter(d => d.span > 1).map(d => ({ s: { r: H, c: 2 + d.start }, e: { r: H, c: 2 + d.start + d.span - 1 } })),
  ];
  add('Відвідування', [
    [rep.title], [],
    ['№', 'Прізвище та ім’я', ...rep.dayHead, ...rep.totalsHead],
    ['', '', ...rep.pairHead, ...rep.totalsHead.map(() => '')],
    ...rep.matrix.map(r => [r.n, r.name, ...r.cells, ...rep.totals(r)]),
    [], [rep.legend],
  ], [4, 26, ...rep.pairHead.map(h => Math.max(6, h.length + 1)), 6, 7, 13], merges);
  add('Підсумок', [
    [rep.title], [],
    rep.summaryHead,
    ...rep.summary.map(rep.summaryRow),
  ], [4, 26, 10, 6, 7, ...(rep.withExcused ? [9] : []), 10]);
  add('За предметами', [
    [`${rep.title}: пропуски за предметами`], [],
    ['№', 'Прізвище та ім’я', ...rep.subjNames],
    ...rep.bySubject.map(r => [r.n, r.name, ...r.counts]),
  ], [4, 26, ...rep.subjNames.map(n => Math.min(30, Math.max(8, n.length)))]);
  if (rep.withExcused) add('Коментарі', [
    [`${rep.title}: причини пропусків`], [],
    ['Дата', 'Пара', 'Студент', 'Відмітка', 'Коментар'],
    ...rep.comments.map(c => [c.date, c.pair, c.name, c.kind, c.note]),
  ], [11, 16, 26, 10, 40]);
  XLSX.writeFile(wb, safeName(rep.title) + '.xlsx');
}

function exportHtml(rep) {
  const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i === 1 ? ' class="name"' : ''}>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>${esc(rep.title)}</title>
<style>
body{font-family:'PT Sans',Arial,sans-serif;font-size:12px;color:#1D2530;margin:24px;}
h1{font-size:18px;margin:0 0 4px;} h2{font-size:14px;margin:24px 0 8px;}
table{border-collapse:collapse;margin-bottom:8px;} th,td{border:1px solid #999;padding:3px 5px;text-align:center;}
th{background:#EEF0F3;font-weight:bold;} td.name{text-align:left;white-space:nowrap;}
table.matrix th.pair{writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;font-weight:normal;padding:5px 2px;}
table.matrix th.day{white-space:nowrap;}
.note{color:#555;} @media print{body{margin:10mm;} h2{break-before:page;} h2:first-of-type{break-before:auto;}}
</style></head><body>
<h1>${esc(rep.title)}</h1>
<p class="note">${rep.legend}. Сформовано ${new Date().toLocaleString('uk-UA')}.</p>
<h2>Відвідування</h2>
<table class="matrix"><thead>
  <tr><th rowspan="2">№</th><th rowspan="2">Прізвище та ім’я</th>${rep.days.map(d => `<th colspan="${d.span}" class="day">${esc(d.label)}</th>`).join('')}
    ${rep.totalsHead.map(h => `<th rowspan="2">${h}</th>`).join('')}</tr>
  <tr>${rep.pairHead.map(h => `<th class="pair">${esc(h)}</th>`).join('')}</tr>
</thead><tbody>${rep.matrix.map(r => `<tr><td>${r.n}</td><td class="name">${esc(r.name)}</td>${r.cells.map(c => `<td>${esc(c)}</td>`).join('')}${rep.totals(r).map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
<h2>Підсумок</h2>
${table(rep.summaryHead, rep.summary.map(rep.summaryRow))}
<h2>Пропуски за предметами</h2>
${table(['№', 'Прізвище та ім’я', ...rep.subjNames], rep.bySubject.map(r => [r.n, r.name, ...r.counts]))}
${rep.comments.length ? `<h2>Причини пропусків</h2>${table(['Дата', 'Пара', 'Студент', 'Відмітка', 'Коментар'], rep.comments.map(c => [c.date, c.pair, c.name, c.kind, c.note]))}` : ''}
</body></html>`;
  saveBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeName(rep.title) + '.html');
}

function exportCsv(rep) {
  const q = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [
    ['№', 'Прізвище та ім’я', ...rep.dayHead, ...rep.totalsHead],
    ['', '', ...rep.pairHead, ...rep.totalsHead.map(() => '')],
    ...rep.matrix.map(r => [r.n, r.name, ...r.cells, ...rep.totals(r)]),
  ];
  // ';' + BOM: opens correctly in Excel with Ukrainian regional settings
  const csv = '﻿' + rows.map(r => r.map(q).join(';')).join('\r\n');
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), safeName(rep.title) + '.csv');
}

export async function mount(root, { state }) {
  const gid = state.profile.groupId;
  root.innerHTML = '<div class="loading-page">Завантаження…</div>';
  const [schedule, students, marksRaw] = await Promise.all([
    read(`schedules/${gid}`), read(`journals/${gid}/students`), read(`journals/${gid}/marks`),
  ]);
  const marks = marksRaw || {};
  if (!schedule?.events) { root.innerHTML = '<div class="empty-state"><h2>Розклад ще не завантажено</h2></div>'; return; }
  if (!students) { root.innerHTML = '<div class="empty-state"><h2>Немає студентів</h2><p><a href="#/students">Додати список студентів</a></p></div>'; return; }

  const allSubjects = [...new Set(Object.values(schedule.events).map(e => e.subject))].sort((a, b) => a.localeCompare(b, 'uk'));
  const subjNames = schedule.subjects || {};
  let preset = 'week';
  let [from, to] = presetRange('week');
  const chosen = new Set(allSubjects);
  const now = new Date();
  const LS_EXC = 'export.withExcused';
  let withExcused = true;
  try { withExcused = localStorage.getItem(LS_EXC) !== '0'; } catch { /* storage unavailable */ }

  root.innerHTML = `
    <div class="page-head"><h1>Експорт</h1></div>
    <section class="panel export-form">
      <h2>Період</h2>
      <div class="seg" role="radiogroup">
        ${[['today', 'Сьогодні'], ['week', 'Цей тиждень'], ['month', `Цей місяць (${MONTHS[now.getMonth()]})`], ['semester', 'Семестр'], ['custom', 'Свій період']]
          .map(([v, l]) => `<label class="seg-item"><input type="radio" name="preset" value="${v}" ${v === preset ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      </div>
      <div class="row-form dates">
        <label>З<input type="date" name="from"></label>
        <label>По<input type="date" name="to"></label>
      </div>
      <h2>Предмети</h2>
      <div class="subjects">
        <label class="check"><input type="checkbox" name="allSubj" checked> Усі</label>
        ${allSubjects.map(sj => `<label class="check"><input type="checkbox" name="subj" value="${esc(sj)}" checked> ${esc(sj)}<span class="muted">${esc(subjNames[sj]?.name ? ' — ' + subjNames[sj].name : '')}</span></label>`).join('')}
      </div>
      <h2>Поважні причини</h2>
      <label class="check"><input type="checkbox" name="withExcused" ${withExcused ? 'checked' : ''}> Враховувати поважні причини</label>
      <p class="muted exc-hint">${withExcused
        ? 'Пропуск з поважної причини позначається (−), є стовпчик «з них поважні» і лист з коментарями.'
        : 'Пропуск з поважної причини рахується як звичайний: − не був.'}</p>
      <div class="form-error" data-err="export"></div>
      <div class="btn-row">
        <button class="primary-btn" data-fmt="xlsx">Завантажити Excel</button>
        <button class="secondary-btn" data-fmt="html">HTML для друку</button>
        <button class="secondary-btn" data-fmt="csv">CSV</button>
      </div>
    </section>
    <section class="export-preview"></section>`;

  const fromEl = $('[name=from]', root), toEl = $('[name=to]', root);
  const syncDates = () => { fromEl.value = from; toEl.value = to; };
  syncDates();

  const report = () => buildReport({ schedule, students, marks, groupName: state.group.name, from, to, subjects: chosen, withExcused });

  function renderPreview() {
    const rep = report();
    const host = $('.export-preview', root);
    if (!rep.events.length) { host.innerHTML = '<div class="empty-state"><h2>За цей період пар немає</h2></div>'; return; }
    host.innerHTML = `
      <h2 class="preview-title">${esc(rep.title)} <span class="muted">(${rep.events.length} пар)</span></h2>
      <div class="table-wrap">
        <table class="register-lite">
          <thead><tr><th class="num">№</th><th>Прізвище та ім’я</th><th class="right">Пар з відмітками</th><th class="right">Був</th><th class="right">Не був</th>
            ${rep.withExcused ? '<th class="right">з них поважні</th>' : ''}<th class="right">Присутність</th></tr></thead>
          <tbody>${rep.summary.map(r => `<tr><td class="num">${r.n}</td><td>${esc(r.name)}</td><td class="right">${r.marked}</td>
            <td class="right">${r.present}</td><td class="right${r.absent ? ' has-absent' : ''}">${r.absent}</td>
            ${rep.withExcused ? `<td class="right${r.excused ? ' has-excused' : ''}">${r.excused}</td>` : ''}<td class="right">${r.pct == null ? '—' : r.pct + '%'}</td></tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'preset') {
      preset = t.value;
      const rg = presetRange(preset, schedule.semester);
      if (rg) { [from, to] = rg; syncDates(); }
      else fromEl.focus();
    }
    if (t.name === 'from' || t.name === 'to') {
      if (fromEl.value && toEl.value) {
        [from, to] = fromEl.value <= toEl.value ? [fromEl.value, toEl.value] : [toEl.value, fromEl.value];
        $('[name=preset][value=custom]', root).checked = true;
        preset = 'custom';
      }
    }
    if (t.name === 'withExcused') {
      withExcused = t.checked;
      try { localStorage.setItem(LS_EXC, withExcused ? '1' : '0'); } catch { /* storage unavailable */ }
      $('.exc-hint', root).textContent = withExcused
        ? 'Пропуск з поважної причини позначається (−), є стовпчик «з них поважні» і лист з коментарями.'
        : 'Пропуск з поважної причини рахується як звичайний: − не був.';
    }
    if (t.name === 'allSubj') {
      $$('[name=subj]', root).forEach(c => { c.checked = t.checked; });
      chosen.clear(); if (t.checked) allSubjects.forEach(s => chosen.add(s));
    }
    if (t.name === 'subj') {
      t.checked ? chosen.add(t.value) : chosen.delete(t.value);
      $('[name=allSubj]', root).checked = chosen.size === allSubjects.length;
    }
    renderPreview();
  });

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-fmt]');
    if (!btn) return;
    const rep = report();
    const err = $('[data-err=export]', root);
    if (!rep.events.length) { err.textContent = 'За вибраний період пар немає.'; return; }
    busy(btn, async () => {
      if (btn.dataset.fmt === 'xlsx') await exportXlsx(rep);
      else if (btn.dataset.fmt === 'html') exportHtml(rep);
      else exportCsv(rep);
      toast('Файл збережено');
    }, err);
  });

  renderPreview();
}
