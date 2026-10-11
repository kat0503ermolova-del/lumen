import { parseQuick, cleanListLine, toKey, fromKey } from './parse.js';
import { holidaysOn, isOffDay, QUOTES, CHEERS, DAY_DONE } from './data.js';
import { occursOn, describeRepeat, REPEAT_PRESETS, presetOf } from './recur.js';
import { burst } from './confetti.js';

/* ───────────── Хранилище ───────────── */

const DATA_KEY = 'lumen.data.v1';
const PREFS_KEY = 'lumen.prefs.v1';

function readJSON(k, fallback) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
}
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Не удалось сохранить — память браузера недоступна'); }
}

const db = readJSON(DATA_KEY, null) || { tasks: [], notes: [] };
db.tasks ||= [];
db.notes ||= [];
const prefs = Object.assign({
  theme: 'gold', view: 'day', myQuotes: [], notesOpen: true, quoteShift: 0, filter: null,
  panelTab: 'notes', briefAuto: true, briefSeen: null, reviewSeen: null, bannerHidden: null, remind: false,
}, readJSON(PREFS_KEY, {}));

let sync = null; // модуль синхронизации, загружается после старта
const persist = () => writeJSON(DATA_KEY, db);
const save = () => { persist(); sync?.schedule(); };
const savePrefs = () => writeJSON(PREFS_KEY, prefs);
// UUID v4 — такой же формат, как в базе
const uid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/* ───────────── Справочники ───────────── */

const CATEGORIES = {
  work: { label: 'Работа', emoji: '💼' },
  personal: { label: 'Личное', emoji: '💖' },
};

const THEMES = [
  ['gold', 'Золото', 'Слоновая кость и тонкое золото'],
  ['pink', 'Розовый', 'Чистый розовый, без лишнего'],
  ['night', 'Ночь', 'Тёмная, с ярким градиентом'],
  ['auto', 'Авто', 'Днём Золото, вечером Ночь'],
];
// старые названия тем из прошлых версий
prefs.theme = { premium: 'gold', sunset: 'pink', neon: 'night', midnight: 'night' }[prefs.theme] || prefs.theme;
if (!THEMES.some(([id]) => id === prefs.theme)) prefs.theme = 'gold';
const effectiveTheme = () => {
  if (prefs.theme !== 'auto') return prefs.theme;
  const h = new Date().getHours();
  return h >= 7 && h < 20 ? 'gold' : 'night';
};
const THEME_COLOR = { gold: '#f9f6f0', pink: '#fff5f8', night: '#07060f' };

/* ───────────── Утилиты ───────────── */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const todayKey = () => toKey(new Date());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addKey = (k, n) => toKey(addDays(fromKey(k), n));
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));
const fmt = (d, o) => new Intl.DateTimeFormat('ru-RU', o).format(d);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const canDrag = matchMedia('(hover: hover) and (pointer: fine)').matches;

function plural(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

function relDayLabel(k) {
  const diff = Math.round((fromKey(k) - fromKey(todayKey())) / 864e5);
  return { 0: 'Сегодня', 1: 'Завтра', '-1': 'Вчера', 2: 'Послезавтра' }[diff] ?? null;
}
function shortDate(k) {
  if (!k) return 'Когда-нибудь';
  const rel = relDayLabel(k);
  if (rel) return rel;
  const d = fromKey(k);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return fmt(d, sameYear ? { day: 'numeric', month: 'short', weekday: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

const ICONS = {
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  notes: '<path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.8-.4-1 .3-2.2 1.4-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="7" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  pin: '<path d="M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  note: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
function hydrateIcons(root = document) {
  $$('[class^="i-"],[class*=" i-"]', root).forEach((el) => {
    const n = [...el.classList].find((c) => c.startsWith('i-')).slice(2);
    if (ICONS[n] && !el.firstChild) el.innerHTML = icon(n);
  });
}

/* ───────────── Состояние ───────────── */

let cursor = fromKey(todayKey());
let view = prefs.view;
let openDayKey = null;
let editing = null; // { id, k }

/* ───────────── Задачи и повторы ───────────── */

const findTask = (id) => db.tasks.find((x) => x.id === id);
const isDone = (t, k) => (t.repeat ? !!t.doneDates?.[k] : !!t.done);
const passFilter = (t) => !prefs.filter || t.kind === 'birthday' || t.category === prefs.filter;

function itemsOn(k, { filter = true } = {}) {
  const out = [];
  for (const t of db.tasks) {
    if ((!filter || passFilter(t)) && occursOn(t, k)) out.push({ t, k, done: isDone(t, k) });
  }
  return out;
}
const workItems = (list) => list.filter((it) => it.t.kind !== 'birthday');

function sortItems(list) {
  return [...list].sort((a, b) =>
    ((b.t.kind === 'birthday') - (a.t.kind === 'birthday')) ||
    (a.done - b.done) ||
    ((a.t.time ? 0 : 1) - (b.t.time ? 0 : 1)) ||
    (a.t.time || '').localeCompare(b.t.time || '') ||
    ((b.t.priority || 0) - (a.t.priority || 0)) ||
    (a.t.createdAt - b.t.createdAt));
}

function addTask(f) {
  const t = {
    id: uid(), title: f.title, note: f.note || '', date: f.date ?? null, time: f.time || null,
    priority: f.priority || 0, category: f.category || null, kind: f.kind || 'task',
    birthYear: f.birthYear || null, repeat: f.repeat || null,
    done: false, doneAt: null, doneDates: {}, skip: [], createdAt: Date.now(),
  };
  db.tasks.push(t);
  save();
  return t;
}

function toggleTask(id, k, originEl) {
  const t = findTask(id);
  if (!t) return;
  let nowDone;
  if (t.repeat) {
    t.doneDates ||= {};
    if (t.doneDates[k]) delete t.doneDates[k];
    else t.doneDates[k] = Date.now();
    nowDone = !!t.doneDates[k];
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    nowDone = t.done;
  }
  save();
  if (nowDone) celebrate(t, k, originEl);
  render();
}

function celebrate(t, k, el) {
  const r = el?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth / 2;
  const y = r ? r.top + r.height / 2 : innerHeight / 2;
  const day = k ? workItems(itemsOn(k, { filter: false })) : [];
  if (day.length > 1 && day.every((it) => it.done)) {
    burst(innerWidth / 2, innerHeight * 0.35, 160, true);
    toast(DAY_DONE[Math.floor(Math.random() * DAY_DONE.length)], 3200);
  } else {
    burst(x, y, 42);
    toast(t.kind === 'birthday' ? 'Поздравление отправлено 🎂' : CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  }
  navigator.vibrate?.(12);
}

// Снимок для «Вернуть»
const snapshot = () => JSON.stringify(db.tasks);
const restoreFrom = (snap) => () => { db.tasks = JSON.parse(snap); save(); render(); };

function moveItem(id, fromK, toK) {
  const t = findTask(id);
  if (!t || fromK === toK) return;
  if (t.kind === 'birthday') { toast('День рождения не переносится 🎂'); return; }
  const snap = snapshot();
  if (t.repeat && fromK) {
    // переносим одно повторение: исключаем день из серии и создаём отдельную задачу
    t.skip = [...(t.skip || []), fromK];
    const done = !!t.doneDates?.[fromK];
    db.tasks.push({ ...structuredClone(t), id: uid(), repeat: null, date: toK, skip: [], doneDates: {}, done, doneAt: done ? Date.now() : null, createdAt: Date.now() });
  } else {
    t.date = toK;
  }
  save();
  render();
  toastUndo(toK ? `Перенесено: ${shortDate(toK).toLowerCase()}` : 'Перенесено в «Когда-нибудь»', restoreFrom(snap));
}

function deleteItem(id, k, series) {
  const t = findTask(id);
  if (!t) return;
  const snap = snapshot();
  if (t.repeat && !series && k) t.skip = [...(t.skip || []), k];
  else db.tasks = db.tasks.filter((x) => x !== t);
  save();
  render();
  toastUndo(t.repeat && !series ? 'Повторение пропущено' : 'Удалено', restoreFrom(snap));
}

/* ───────────── Статистика ───────────── */

function completionsByDay() {
  const c = {};
  const inc = (ts) => { const k = toKey(new Date(ts)); c[k] = (c[k] || 0) + 1; };
  for (const t of db.tasks) {
    if (t.kind === 'birthday') continue;
    if (t.repeat) Object.values(t.doneDates || {}).forEach(inc);
    else if (t.done && t.doneAt) inc(t.doneAt);
  }
  return c;
}
function streak() {
  const c = completionsByDay();
  let d = new Date();
  if (!c[toKey(d)]) d = addDays(d, -1);
  let n = 0;
  while (c[toKey(d)]) { n++; d = addDays(d, -1); }
  return n;
}
function upcomingBirthdays(days = 7) {
  const out = [];
  const tk = todayKey();
  for (const t of db.tasks.filter((x) => x.kind === 'birthday')) {
    for (let i = 0; i <= days; i++) {
      const k = addKey(tk, i);
      if (occursOn(t, k)) { out.push({ t, k, inDays: i }); break; }
    }
  }
  return out.sort((a, b) => a.inDays - b.inDays);
}
const ageOn = (t, k) => (t.birthYear ? Number(k.slice(0, 4)) - t.birthYear : null);

/* ───────────── Рендер: общие куски ───────────── */

function holidayChips(k) {
  return holidaysOn(k).map((h) => `<span class="hchip ${h.kind}${h.off ? ' off' : ''}">${esc(h.name)}</span>`).join('');
}

const dragAttr = (it) => `data-id="${it.t.id}" data-k="${it.k || ''}"${canDrag && it.t.kind !== 'birthday' ? ' draggable="true"' : ''}`;

function taskRow(it, { showDate = false, compact = false } = {}) {
  const t = it.t;
  const bday = t.kind === 'birthday';
  const meta = [];
  if (showDate) meta.push(`<span class="meta-date${t.date && t.date < todayKey() ? ' late' : ''}">${esc(shortDate(it.k || t.date))}</span>`);
  if (t.time) meta.push(`<span>${icon('clock')}${t.time}</span>`);
  if (bday && it.k && ageOn(t, it.k)) meta.push(`<span>исполняется ${ageOn(t, it.k)}</span>`);
  if (t.repeat && !bday && !compact) meta.push(`<span>${icon('repeat')}${esc(describeRepeat(t.repeat, t.date))}</span>`);
  else if (t.repeat && !bday) meta.push(`<span>${icon('repeat')}</span>`);
  if (t.category && CATEGORIES[t.category] && !compact) meta.push(`<span><i class="em">${CATEGORIES[t.category].emoji}</i>${CATEGORIES[t.category].label}</span>`);
  if (t.note && !compact) meta.push(`<span>${icon('note')}</span>`);
  const cls = ['task', it.done && 'done', compact && 'compact', `p${t.priority || 0}`, t.category && `cat-${t.category}`, bday && 'bday'].filter(Boolean).join(' ');
  return `<div class="${cls}" ${dragAttr(it)}>
    <button class="check" data-action="toggle" data-id="${t.id}" data-k="${it.k || ''}" aria-label="${it.done ? 'Вернуть' : 'Выполнить'}">${bday ? '<b>🎂</b>' : ''}<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9"/></svg></button>
    <button class="task-body" data-action="edit" data-id="${t.id}" data-k="${it.k || ''}">
      <span class="task-title">${esc(t.title)}</span>
      ${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}
    </button>
  </div>`;
}

function progressRing(done, total) {
  const p = total ? done / total : 0;
  const C = 2 * Math.PI * 22;
  return `<div class="ring" title="${done} из ${total}">
    <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" class="ring-bg"/><circle cx="26" cy="26" r="22" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>
    <span>${total ? Math.round(p * 100) + '%' : '—'}</span></div>`;
}

function dayContent(k, { full = false } = {}) {
  const d = fromKey(k);
  const list = sortItems(itemsOn(k));
  const work = workItems(list);
  const open = list.filter((it) => !it.done);
  const done = list.filter((it) => it.done);
  const isToday = k === todayKey();
  const rel = relDayLabel(k);
  const off = isOffDay(k, d.getDay());

  let html = `<div class="day-hero">
    <div>
      <div class="day-kicker">${rel ? rel + ' · ' : ''}${cap(fmt(d, { weekday: 'long' }))}${off ? ' · <span class="offword">выходной</span>' : ''}</div>
      <div class="day-big">${fmt(d, { day: 'numeric', month: 'long' })}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}</div>
      <div class="hchips">${holidayChips(k)}</div>
    </div>
    ${progressRing(work.filter((it) => it.done).length, work.length)}
  </div>`;

  if (full && isToday) {
    const overdue = sortItems(db.tasks.filter((t) => !t.repeat && !t.done && t.date && t.date < k && passFilter(t)).map((t) => ({ t, k: t.date, done: false })));
    if (overdue.length) {
      html += `<div class="group"><div class="group-title warn">Просрочено <span>${overdue.length}</span>
        <button class="link" data-action="move-overdue">Перенести на сегодня</button></div>
        ${overdue.map((it) => taskRow(it, { showDate: true })).join('')}</div>`;
    }
  }

  if (open.length) html += `<div class="group">${open.map((it) => taskRow(it)).join('')}</div>`;
  else if (!done.length) html += `<div class="empty">${isToday ? 'Свободный день. Добавь первую задачу — или просто отдохни ☁️' : 'Пока пусто. Добавь задачу в поле ниже.'}</div>`;
  else html += `<div class="empty win">Всё сделано ✨</div>`;

  if (done.length) {
    html += `<details class="group done-group"${full ? '' : ' open'}><summary class="group-title">Выполнено <span>${done.length}</span></summary>${done.map((it) => taskRow(it)).join('')}</details>`;
  }
  return html;
}

/* ───────────── Рендер: виды ───────────── */

function renderDay() {
  const k = toKey(cursor);
  $('#viewTitle').textContent = relDayLabel(k) || cap(fmt(cursor, { weekday: 'short', day: 'numeric', month: 'long' }));
  return `<div class="day-view glass" data-drop="${k}">${dayContent(k, { full: true })}</div>`;
}

function renderWeek() {
  const start = startOfWeek(cursor);
  const end = addDays(start, 6);
  $('#viewTitle').textContent = start.getMonth() === end.getMonth()
    ? `${start.getDate()}–${fmt(end, { day: 'numeric', month: 'long' })}`
    : `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end, { day: 'numeric', month: 'short' })}`;
  const tk = todayKey();
  let html = '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const k = toKey(d);
    const list = sortItems(itemsOn(k));
    const work = workItems(list);
    const off = isOffDay(k, d.getDay());
    html += `<section class="wday glass${k === tk ? ' is-today' : ''}${off ? ' is-off' : ''}" data-drop="${k}">
      <button class="wday-head" data-action="open-day" data-key="${k}">
        <span class="wd">${WD_SHORT[i]}</span><span class="wn">${d.getDate()}</span>
        <span class="wcount">${work.length ? `${work.filter((it) => it.done).length}/${work.length}` : ''}</span>
      </button>
      <div class="hchips">${holidayChips(k)}</div>
      <div class="wtasks">${list.map((it) => taskRow(it, { compact: true })).join('')}</div>
      <button class="wadd" data-action="open-day" data-key="${k}" aria-label="Добавить">${icon('plus')}</button>
    </section>`;
  }
  return html + '</div>';
}

function renderMonth() {
  const y = cursor.getFullYear(), m = cursor.getMonth();
  $('#viewTitle').textContent = `${MONTHS_NOM[m]} ${y}`;
  const first = new Date(y, m, 1);
  const start = startOfWeek(first);
  const tk = todayKey();
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(y, m + 1, 0).getDate()) / 7);
  let html = `<div class="month glass"><div class="mhead">${WD_SHORT.map((w, i) => `<span class="${i > 4 ? 'we' : ''}">${w}</span>`).join('')}</div><div class="mgrid">`;
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const k = toKey(d);
    // в клетке месяца разовые дела важнее рутины: повторы уходят вниз
    const list = sortItems(itemsOn(k)).sort((a, b) => (a.done - b.done) || (!!a.t.repeat && a.t.kind !== 'birthday') - (!!b.t.repeat && b.t.kind !== 'birthday'));
    const hol = holidaysOn(k);
    const cls = ['mcell', d.getMonth() !== m && 'out', k === tk && 'is-today', isOffDay(k, d.getDay()) && 'is-off', hol.length && 'has-hol'].filter(Boolean).join(' ');
    html += `<div class="${cls}" role="button" tabindex="0" data-action="open-day" data-key="${k}" data-drop="${k}">
      <span class="mnum">${d.getDate()}</span>
      ${hol.length ? `<span class="mhol ${hol[0].kind}${hol[0].off ? ' off' : ''}">${esc(hol[0].name)}</span>` : ''}
      <span class="mtasks">${list.slice(0, 3).map((it) => `<span class="mt p${it.t.priority || 0}${it.t.category ? ' cat-' + it.t.category : ''}${it.done ? ' done' : ''}${it.t.kind === 'birthday' ? ' bday' : ''}" ${dragAttr(it)}>${it.t.kind === 'birthday' ? '🎂 ' : ''}${esc(it.t.title)}</span>`).join('')}${list.length > 3 ? `<span class="mmore">+${list.length - 3}</span>` : ''}</span>
      <span class="mdots">${list.slice(0, 4).map((it) => `<i class="p${it.t.priority || 0}${it.t.category ? ' cat-' + it.t.category : ''}${it.done ? ' done' : ''}${it.t.kind === 'birthday' ? ' bday' : ''}"></i>`).join('')}</span>
    </div>`;
  }
  return html + '</div></div>';
}

function renderYear() {
  const y = cursor.getFullYear();
  $('#viewTitle').textContent = String(y);
  const tk = todayKey();
  const yStart = `${y}-01-01`, yEnd = `${y}-12-31`;
  const relevant = db.tasks.filter((t) => t.date && passFilter(t) && (t.repeat ? t.date <= yEnd : t.date >= yStart && t.date <= yEnd));
  let html = '<div class="year">';
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    html += `<section class="ymonth glass${y === new Date().getFullYear() && m === new Date().getMonth() ? ' is-current' : ''}">
      <button class="ytitle" data-action="goto-month" data-m="${m}">${MONTHS_NOM[m]}</button>
      <div class="ygrid">${WD_SHORT.map((w) => `<span class="ywd">${w[0]}</span>`).join('')}${'<span></span>'.repeat(lead)}`;
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d);
      const k = toKey(dt);
      const hol = holidaysOn(k);
      const occ = relevant.filter((t) => occursOn(t, k));
      const cls = ['yd', k === tk && 'is-today', isOffDay(k, dt.getDay()) && 'is-off', hol.length && 'has-hol',
        occ.some((t) => t.kind !== 'birthday') && 'has-tasks', occ.some((t) => t.kind === 'birthday') && 'has-bday'].filter(Boolean).join(' ');
      html += `<button class="${cls}" data-action="open-day" data-key="${k}" data-drop="${k}" title="${esc([...hol.map((h) => h.name), ...occ.filter((t) => t.kind === 'birthday').map((t) => '🎂 ' + t.title)].join(', '))}">${d}</button>`;
    }
    html += '</div></section>';
  }
  return html + '</div>';
}

/* ───────────── Шапка, баннеры, цитата, фильтры ───────────── */

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 17 ? 'Добрый день' : h < 23 ? 'Добрый вечер' : 'Доброй ночи';
}

function renderHeader() {
  $('#greet').textContent = greeting();
  const tk = todayKey();
  const work = workItems(itemsOn(tk, { filter: false }));
  const open = work.filter((it) => !it.done).length;
  const hol = holidaysOn(tk)[0];
  const st = streak();
  $('#todayLine').innerHTML = cap(fmt(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }))
    + (hol ? ` · <span class="accent-text">${esc(hol.name)}</span>` : '')
    + (work.length ? ` · ${open ? `${open} ${plural(open, 'задача', 'задачи', 'задач')} впереди` : 'всё сделано ✨'}` : '')
    + (st >= 2 ? ` · <span class="streak" title="Дней подряд с выполненными задачами">🔥 ${st}</span>` : '');
  $$('#viewSeg button').forEach((b, i) => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
    if (on) $('#viewSeg').style.setProperty('--i', i);
  });
}

function weekId(d = new Date()) { return toKey(startOfWeek(d)); }
function reviewWeekStart() {
  const now = new Date();
  // в понедельник подводим итоги прошлой недели, в остальные дни — текущей
  return now.getDay() === 1 ? addDays(startOfWeek(now), -7) : startOfWeek(now);
}

function renderBanners() {
  const tk = todayKey();
  const out = [];
  if (prefs.bannerHidden !== tk) {
    for (const b of upcomingBirthdays(3)) {
      const age = ageOn(b.t, b.k);
      const name = b.t.title.replace(/^день рождения:?\s*/i, '');
      const when = b.inDays === 0 ? 'Сегодня' : b.inDays === 1 ? 'Завтра' : `Через ${b.inDays} ${plural(b.inDays, 'день', 'дня', 'дней')}`;
      out.push(`<div class="banner glass">🎂 <span><b>${when}</b> день рождения ${esc(name)}${age ? ` (${age})` : ''}${b.inDays === 0 ? ' — не забудь поздравить!' : ''}</span><button class="icon-btn xs" data-action="hide-banners" aria-label="Скрыть">${icon('close')}</button></div>`);
    }
  }
  const dow = new Date().getDay();
  const reviewTime = (dow === 0 && new Date().getHours() >= 15) || dow === 1;
  const rid = toKey(reviewWeekStart());
  if (reviewTime && prefs.reviewSeen !== rid) {
    out.push(`<div class="banner glass review">📊 <span><b>Итоги недели готовы.</b> Посмотри, как прошло.</span><button class="btn-primary sm" data-action="review">Смотреть</button></div>`);
  }
  $('#banners').innerHTML = out.join('');
}

function renderQuote() {
  const dayIndex = Math.floor(fromKey(todayKey()).getTime() / 864e5);
  const [text, author] = quoteFor(dayIndex + prefs.quoteShift);
  $('#quote').innerHTML = `<div class="q-label">Вдохновение дня</div>
    <blockquote>${esc(text)}</blockquote>
    <div class="q-foot">${author ? `<span class="q-author">— ${esc(author)}</span>` : ''}
    <button class="icon-btn xs" data-action="quote-next" title="Другая цитата" aria-label="Другая цитата">${icon('refresh')}</button></div>`;
}
// свои цитаты идут вперемешку со встроенными: каждая третья — твоя
function quoteFor(i) {
  const mine = prefs.myQuotes || [];
  const pick = (list, n) => list[((n % list.length) + list.length) % list.length];
  if (mine.length && ((i % 3) + 3) % 3 === 0) return pick(mine, Math.floor(i / 3));
  return pick(QUOTES, i);
}
function parseMyQuotes(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.*\S)\s+[—–-]\s+(.+)$/);
    return m ? [m[1].replace(/^[«"]|[»"]$/g, ''), m[2]] : [l.replace(/^[«"]|[»"]$/g, ''), ''];
  });
}

function renderFilters() {
  const used = new Set(db.tasks.map((t) => t.category).filter(Boolean));
  if (prefs.filter && !used.has(prefs.filter)) prefs.filter = null;
  if (!used.size) { $('#filters').innerHTML = ''; return; }
  $('#filters').innerHTML = `<button class="fchip${!prefs.filter ? ' on' : ''}" data-action="filter" data-cat="">Все</button>`
    + Object.entries(CATEGORIES).filter(([id]) => used.has(id))
      .map(([id, c]) => `<button class="fchip cat-${id}${prefs.filter === id ? ' on' : ''}" data-action="filter" data-cat="${id}"><i class="em">${c.emoji}</i>${c.label}</button>`).join('');
}

/* ───────────── Панель: заметки и «когда-нибудь» ───────────── */

function timeAgo(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  const d = new Date(ts);
  if (toKey(d) === todayKey()) return `сегодня в ${fmt(d, { hour: '2-digit', minute: '2-digit' })}`;
  return fmt(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderNotes() {
  const q = $('#noteSearch').value.trim().toLowerCase();
  const list = db.notes
    .filter((n) => !q || n.text.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
  $('#notesList').innerHTML = list.length ? list.map((n) => `
    <article class="note${n.pinned ? ' pinned' : ''}" data-note-id="${n.id}">
      <div class="note-text" contenteditable="plaintext-only" spellcheck="true" data-note="${n.id}">${esc(n.text)}</div>
      <div class="note-foot"><span>${timeAgo(n.updatedAt)}</span>
        <span class="note-acts">
          <button class="icon-btn xs${n.pinned ? ' on' : ''}" data-action="note-pin" data-id="${n.id}" title="Закрепить">${icon('pin')}</button>
          <button class="icon-btn xs" data-action="note-to-task" data-id="${n.id}" title="Сделать задачей">${icon('plus')}</button>
          <button class="icon-btn xs" data-action="note-del" data-id="${n.id}" title="Удалить">${icon('trash')}</button>
        </span></div>
    </article>`).join('') : `<div class="empty small">${q ? 'Ничего не нашлось' : 'Здесь будут твои мысли и идеи'}</div>`;
}

function renderSomeday() {
  const list = sortItems(db.tasks.filter((t) => !t.date).map((t) => ({ t, k: null, done: !!t.done })));
  const open = list.filter((it) => !it.done);
  const done = list.filter((it) => it.done);
  $('#somedayList').innerHTML = (open.length ? open.map((it) => taskRow(it)).join('') : '<div class="empty small">Пусто. Добавь сюда то, что хочется сделать «когда-нибудь» ✨</div>')
    + (done.length ? `<details class="group done-group"><summary class="group-title">Выполнено <span>${done.length}</span></summary>${done.map((it) => taskRow(it)).join('')}</details>` : '');
  $$('#panelTabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === prefs.panelTab);
    if (b.dataset.tab === 'someday') b.dataset.count = open.length || '';
  });
  $$('.tab-pane').forEach((p) => { p.hidden = p.dataset.pane !== prefs.panelTab; });
}

function renderLayout() {
  const th = effectiveTheme();
  document.documentElement.dataset.theme = th;
  $('meta[name="theme-color"]').content = THEME_COLOR[th];
  document.body.classList.toggle('notes-open', !!prefs.notesOpen);
}

/* ───────────── Главный рендер ───────────── */

function render() {
  renderLayout();
  renderHeader();
  renderBanners();
  renderFilters();
  const body = $('#viewBody');
  body.dataset.view = view;
  body.innerHTML = view === 'day' ? renderDay() : view === 'week' ? renderWeek() : view === 'month' ? renderMonth() : renderYear();
  renderSomeday();
  if (openDayKey && $('#daySheet').open) $('#daySheetBody').innerHTML = dayContent(openDayKey);
  if ($('#briefSheet').open) renderBrief();
  if ($('#searchSheet').open) renderSearch();
}

function animate(cls) {
  const vb = $('#viewBody');
  vb.classList.remove('enter', 'slide-l', 'slide-r');
  void vb.offsetWidth;
  vb.classList.add(cls);
}

function setView(v) {
  view = v;
  prefs.view = v;
  savePrefs();
  animate('enter');
  render();
}

function step(dir) {
  const y = cursor.getFullYear(), m = cursor.getMonth(), d = cursor.getDate();
  if (view === 'day') cursor = addDays(cursor, dir);
  if (view === 'week') cursor = addDays(cursor, dir * 7);
  if (view === 'month') cursor = new Date(y, m + dir, Math.min(d, 28));
  if (view === 'year') cursor = new Date(y + dir, m, Math.min(d, 28));
  animate(dir > 0 ? 'slide-l' : 'slide-r');
  render();
}

/* ───────────── Листы ───────────── */

function openSheet(id) {
  const dlg = $(id);
  if (!dlg.open) dlg.showModal();
}
function closeSheets() {
  $$('dialog[open]').forEach((d) => d.close());
}

function openDay(k) {
  openDayKey = k;
  $('#daySheetBody').innerHTML = dayContent(k);
  $('#dayAddInput').value = '';
  openSheet('#daySheet');
}

/* — Редактирование задачи — */

const form = $('#taskForm');

function openTask(id, k) {
  const t = findTask(id);
  if (!t) return;
  editing = { id, k: k || null };
  form.title.value = t.title;
  form.date.value = t.date || '';
  form.time.value = t.time || '';
  form.note.value = t.note || '';
  form.birthday.checked = t.kind === 'birthday';
  form.birthYear.value = t.birthYear || '';
  form.dataset.repeat = presetOf(t.repeat);
  form.dataset.days = JSON.stringify(t.repeat?.days || []);
  form.dataset.custom = t.repeat && presetOf(t.repeat) === 'custom' ? JSON.stringify(t.repeat) : '';
  form.dataset.cat = t.category || '';
  setPrio(t.priority || 0);
  renderPickers();
  $('#taskActions').innerHTML = (t.repeat && t.kind !== 'birthday' && k
    ? `<button type="button" class="btn-ghost danger" data-action="task-skip">Удалить этот день</button><button type="button" class="btn-ghost danger" data-action="task-delete">Всю серию</button>`
    : `<button type="button" class="btn-ghost danger" data-action="task-delete">Удалить</button>`)
    + `<span class="spacer"></span><button type="button" class="btn-ghost" data-action="sheet-close">Отмена</button><button type="submit" class="btn-primary" value="save">Сохранить</button>`;
  closeSheets();
  openSheet('#taskSheet');
}

function renderPickers() {
  const bday = form.birthday.checked;
  const rp = form.dataset.repeat;
  const presets = [...REPEAT_PRESETS];
  if (rp === 'custom') presets.push(['custom', 'Свой: ' + describeRepeat(JSON.parse(form.dataset.custom), form.date.value || todayKey()), null]);
  $('#repeatPick').innerHTML = presets.map(([id, label]) => `<button type="button" class="pchip${rp === id ? ' on' : ''}" data-repeat="${id}"${bday ? ' disabled' : ''}>${label}</button>`).join('');
  const weekly = !bday && (rp === 'week' || rp === 'week2');
  $('#wdPick').hidden = !weekly;
  if (weekly) {
    let days = JSON.parse(form.dataset.days || '[]');
    if (!days.length) days = [fromKey(form.date.value || todayKey()).getDay()];
    $('#wdPick').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d, i) => `<button type="button" class="pchip round${days.includes(d) ? ' on' : ''}" data-wd="${d}">${WD_SHORT[i]}</button>`).join('');
  }
  const cat = form.dataset.cat;
  $('#catPick').innerHTML = `<button type="button" class="pchip${!cat ? ' on' : ''}" data-cat="">Без категории</button>`
    + Object.entries(CATEGORIES).map(([id, c]) => `<button type="button" class="pchip cat-${id}${cat === id ? ' on' : ''}" data-cat="${id}"><i class="em">${c.emoji}</i>${c.label}</button>`).join('');
  $('#byYear').hidden = !bday;
  $('#repeatPick').classList.toggle('muted', bday);
}

$('#repeatPick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-repeat]');
  if (!b || b.disabled) return;
  form.dataset.repeat = b.dataset.repeat;
  if (!form.date.value && b.dataset.repeat !== 'none') form.date.value = todayKey();
  renderPickers();
});
$('#wdPick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-wd]');
  if (!b) return;
  let days = JSON.parse(form.dataset.days || '[]');
  if (!days.length) days = [fromKey(form.date.value || todayKey()).getDay()];
  const d = +b.dataset.wd;
  days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
  if (!days.length) return;
  form.dataset.days = JSON.stringify(days);
  renderPickers();
});
$('#catPick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  form.dataset.cat = b.dataset.cat;
  renderPickers();
});
form.birthday.addEventListener('change', renderPickers);

function setPrio(p) {
  $$('#prioSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.p === p));
  $('#prioSeg').dataset.value = p;
}
$('#prioSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) setPrio(+b.dataset.p);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = findTask(editing?.id);
  if (t && form.title.value.trim()) {
    t.title = form.title.value.trim();
    t.date = form.date.value || null;
    t.time = form.time.value || null;
    t.note = form.note.value.trim();
    t.priority = +$('#prioSeg').dataset.value || 0;
    t.category = form.dataset.cat || null;
    if (form.birthday.checked) {
      t.kind = 'birthday';
      t.repeat = { freq: 'year', interval: 1 };
      t.birthYear = +form.birthYear.value || null;
    } else {
      t.kind = 'task';
      t.birthYear = null;
      const rp = form.dataset.repeat;
      if (rp === 'custom') t.repeat = JSON.parse(form.dataset.custom);
      else {
        const preset = REPEAT_PRESETS.find(([id]) => id === rp)?.[2];
        t.repeat = preset ? structuredClone(preset) : null;
        const days = JSON.parse(form.dataset.days || '[]');
        if (t.repeat?.freq === 'week' && days.length) t.repeat.days = days;
      }
    }
    if (t.repeat) {
      t.date ||= todayKey();
      t.doneDates ||= {};
      t.skip ||= [];
    }
    save();
  }
  $('#taskSheet').close();
  render();
});

/* — Быстрые действия (долгое нажатие / правый клик) — */

let actionCtx = null;

function openActions(id, k) {
  const t = findTask(id);
  if (!t) return;
  actionCtx = { id, k: k || null };
  const done = isDone(t, k);
  const bday = t.kind === 'birthday';
  const moves = [['today', 'Сегодня', '☀️'], ['tomorrow', 'Завтра', '🌅'], ['weekend', 'На выходные', '🛋'], ['monday', 'В понедельник', '📅'], ['week', 'Через неделю', '⏭'], ['none', 'Когда-нибудь', '💭']];
  $('#actionBody').innerHTML = `<div class="sheet-grab"></div>
    <div class="act-title">${bday ? '🎂 ' : ''}${esc(t.title)}</div>
    <div class="act-sub">${esc(shortDate(k || t.date))}${t.time ? ' · ' + t.time : ''}${t.repeat && !bday ? ' · ' + esc(describeRepeat(t.repeat, t.date)) : ''}</div>
    ${bday ? '' : `<div class="act-grid">${moves.map(([to, label, e]) => `<button data-action="move-to" data-to="${to}"><span>${e}</span>${label}</button>`).join('')}</div>`}
    <div class="menu-list">
      <button data-action="act-toggle"><span>${done ? '↩️' : '✅'}</span>${done ? 'Вернуть в работу' : 'Выполнить'}</button>
      <button data-action="act-edit"><span>✏️</span>Изменить, выбрать дату</button>
      ${t.repeat && !bday && k ? `<button data-action="act-skip" class="danger"><span>⏭</span>Пропустить этот день</button>` : ''}
      <button data-action="act-delete" class="danger"><span>🗑</span>${t.repeat && !bday ? 'Удалить всю серию' : 'Удалить'}</button>
    </div>`;
  closeSheets();
  openSheet('#actionSheet');
}

function targetKey(to) {
  const today = fromKey(todayKey());
  if (to === 'today') return todayKey();
  if (to === 'tomorrow') return toKey(addDays(today, 1));
  if (to === 'weekend') return toKey(addDays(today, (6 - today.getDay() + 7) % 7 || 7));
  if (to === 'monday') return toKey(addDays(today, ((1 - today.getDay() + 7) % 7) || 7));
  if (to === 'week') return toKey(addDays(today, 7));
  return null;
}

/* — Мой день — */

function renderBrief() {
  const tk = todayKey();
  const items = sortItems(itemsOn(tk, { filter: false }));
  const work = workItems(items).filter((it) => !it.done)
    .sort((a, b) => ((b.t.priority || 0) - (a.t.priority || 0)) || (a.t.time || '99').localeCompare(b.t.time || '99'));
  const top = work.slice(0, 3);
  const bdays = upcomingBirthdays(7);
  const st = streak();
  const dayIndex = Math.floor(fromKey(tk).getTime() / 864e5);
  const [text, author] = quoteFor(dayIndex + prefs.quoteShift);
  $('#briefBody').innerHTML = `<div class="sheet-grab"></div>
    <div class="brief-hero">
      <div class="greet big">${greeting()}</div>
      <div class="brief-date">${cap(fmt(new Date(), { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
      <div class="hchips">${holidayChips(tk)}</div>
    </div>
    <blockquote class="brief-quote">${esc(text)}${author ? `<cite>— ${esc(author)}</cite>` : ''}</blockquote>
    <h4>Главное сегодня</h4>
    ${top.length ? top.map((it) => taskRow(it)).join('') : '<div class="empty small">День свободен. Запланируй что-нибудь приятное 🌸</div>'}
    ${work.length > 3 ? `<div class="brief-more">и ещё ${work.length - 3} ${plural(work.length - 3, 'задача', 'задачи', 'задач')}</div>` : ''}
    ${bdays.length ? `<h4>Дни рождения</h4><div class="brief-bdays">${bdays.map((b) => `<div>🎂 <b>${esc(b.inDays === 0 ? 'Сегодня' : shortDate(b.k))}</b> · ${esc(b.t.title.replace(/^день рождения:?\s*/i, ''))}${ageOn(b.t, b.k) ? ` <span class="muted">(${ageOn(b.t, b.k)})</span>` : ''}</div>`).join('')}</div>` : ''}
    ${st ? `<div class="brief-streak">🔥 <b>${st} ${plural(st, 'день', 'дня', 'дней')} подряд</b> с выполненными задачами. Не прерывай серию!</div>` : ''}
    <div class="sheet-actions">
      <label class="switch small"><input type="checkbox" id="briefAuto" ${prefs.briefAuto ? 'checked' : ''}/><i></i><span>Показывать утром</span></label>
      <span class="spacer"></span>
      <button class="btn-primary" data-action="sheet-close">Начать день ✨</button>
    </div>`;
  $('#briefAuto').onchange = (e) => { prefs.briefAuto = e.target.checked; savePrefs(); };
}
function openBrief() {
  closeSheets();
  renderBrief();
  openSheet('#briefSheet');
}

/* — Итоги недели — */

function openReview() {
  const start = reviewWeekStart();
  prefs.reviewSeen = toKey(start);
  savePrefs();
  const days = [...Array(7)].map((_, i) => {
    const k = toKey(addDays(start, i));
    const w = workItems(itemsOn(k, { filter: false }));
    return { k, planned: w.length, done: w.filter((it) => it.done).length, items: w };
  });
  const planned = days.reduce((s, d) => s + d.planned, 0);
  const done = days.reduce((s, d) => s + d.done, 0);
  const pct = planned ? Math.round((done / planned) * 100) : 0;
  const best = days.reduce((a, b) => (b.done > a.done ? b : a), days[0]);
  const max = Math.max(1, ...days.map((d) => d.planned));
  const cats = {};
  days.forEach((d) => d.items.filter((it) => it.done && it.t.category).forEach((it) => { cats[it.t.category] = (cats[it.t.category] || 0) + 1; }));
  const msg = pct >= 80 ? 'Невероятная неделя! Ты в отличной форме 🌟'
    : pct >= 50 ? 'Хорошая, ровная неделя. Так держать 💛'
    : done > 0 ? 'Каждый шаг считается. Следующая будет ещё лучше 🌱'
    : 'Неделя для отдыха — это тоже нормально ☁️';
  const end = addDays(start, 6);
  $('#reviewBody').innerHTML = `<div class="sheet-grab"></div>
    <div class="q-label">Итоги недели</div>
    <h3>${start.getDate()} ${fmt(start, { month: 'short' })} – ${end.getDate()} ${fmt(end, { month: 'short' })}</h3>
    <p class="review-msg">${msg}</p>
    <div class="stats">
      <div class="stat"><b>${done}</b><span>${plural(done, 'задача сделана', 'задачи сделаны', 'задач сделано')}</span></div>
      <div class="stat"><b>${pct}%</b><span>от плана</span></div>
      <div class="stat"><b>🔥 ${streak()}</b><span>дней подряд</span></div>
    </div>
    <div class="bars">${days.map((d, i) => `<div class="bar${d === best && best.done ? ' best' : ''}" title="${d.done} из ${d.planned}">
      <div class="bar-track"><div class="bar-plan" style="height:${(d.planned / max) * 100}%"></div><div class="bar-done" style="height:${(d.done / max) * 100}%"></div></div>
      <span>${WD_SHORT[i]}</span></div>`).join('')}</div>
    ${best.done ? `<p class="muted center">Самый продуктивный день — <b>${fmt(fromKey(best.k), { weekday: 'long' })}</b> (${best.done})</p>` : ''}
    ${Object.keys(cats).length ? `<div class="cat-sum">${Object.entries(cats).map(([c, n]) => `<span class="pchip cat-${c} on"><i class="em">${CATEGORIES[c].emoji}</i>${CATEGORIES[c].label} · ${n}</span>`).join('')}</div>` : ''}
    <div class="sheet-actions"><span class="spacer"></span><button class="btn-primary" data-action="sheet-close">Вперёд, к новой неделе</button></div>`;
  closeSheets();
  openSheet('#reviewSheet');
  render();
  if (pct >= 80) setTimeout(() => burst(innerWidth / 2, innerHeight * 0.3, 120, true), 300);
}

/* — Оформление — */

function openThemes() {
  $('#themeBody').innerHTML = `<div class="sheet-grab"></div><h3>Оформление</h3>
    <div class="theme-grid">${THEMES.map(([id, name, desc]) => `<button class="theme-card${prefs.theme === id ? ' on' : ''}" data-action="set-theme" data-theme="${id}">
      <span class="swatch sw-${id}"></span><b>${name}</b><small>${desc}</small></button>`).join('')}</div>
    <div class="field my-quotes">
      <span>Мои цитаты</span>
      <p class="muted small">Любимые строчки из песен, фильмов, от подруг — по одной на строку. Автора можно добавить через тире: <i>Текст — Автор</i>. Они будут появляться среди цитат дня.</p>
      <textarea id="myQuotes" placeholder="Сначала кофе, потом мир — Я">${esc((prefs.myQuotes || []).map(([t, a]) => (a ? `${t} — ${a}` : t)).join('\n'))}</textarea>
    </div>
    <div class="sheet-actions"><span class="spacer"></span><button class="btn-primary" data-action="save-quotes">Готово</button></div>`;
  closeSheets();
  openSheet('#themeSheet');
}

/* — Поиск — */

function renderSearch() {
  const q = $('#searchInput').value.trim().toLowerCase();
  if (!q) { $('#searchResults').innerHTML = '<div class="empty small">Начни печатать: название задачи, слово из заметки…</div>'; return; }
  const tk = todayKey();
  const tasks = db.tasks.filter((t) => (t.title + ' ' + (t.note || '')).toLowerCase().includes(q))
    .sort((a, b) => ((a.date || '9') >= tk ? 0 : 1) - ((b.date || '9') >= tk ? 0 : 1) || (a.date || '9').localeCompare(b.date || '9'))
    .slice(0, 30);
  const notes = db.notes.filter((n) => n.text.toLowerCase().includes(q)).slice(0, 10);
  $('#searchResults').innerHTML = (tasks.length ? `<div class="group-title">Задачи <span>${tasks.length}</span></div>${tasks.map((t) => taskRow({ t, k: t.repeat ? null : t.date, done: t.repeat ? false : !!t.done }, { showDate: true })).join('')}` : '')
    + (notes.length ? `<div class="group-title">Заметки <span>${notes.length}</span></div>${notes.map((n) => `<button class="search-note" data-action="open-note" data-q="${esc(q)}">${esc(n.text.slice(0, 140))}</button>`).join('')}` : '')
    || '<div class="empty small">Ничего не нашлось</div>';
}
$('#searchInput').addEventListener('input', renderSearch);

/* — Синхронизация — */

let syncState = { status: 'off', email: null, lastSync: 0 };
let syncMsg = '';

function onSyncStatus(st) {
  syncState = st;
  const btn = $('.actions [data-action="menu"]');
  btn.dataset.sync = st.status;
  btn.title = { ok: 'Синхронизировано', syncing: 'Синхронизация…', error: 'Нет связи с облаком', off: 'Ещё' }[st.status];
  $('#syncLabel').textContent = st.email ? `Синхронизация: ${st.status === 'error' ? 'нет связи' : 'включена'}` : 'Синхронизация: выключена';
  if ($('#syncSheet').open) renderSync();
}

function renderSync() {
  const st = syncState;
  let body;
  if (!sync) {
    body = `<p>Не удалось подключиться к облаку. Проверь интернет и перезагрузи страницу.</p>`;
  } else if (st.email) {
    const when = st.lastSync ? timeAgo(st.lastSync) : '—';
    body = `<div class="sync-ok"><span class="sync-dot ${st.status}"></span><div>
        <b>${st.status === 'error' ? 'Нет связи — изменения сохранятся и отправятся позже' : st.status === 'syncing' ? 'Синхронизация…' : 'Всё синхронизировано'}</b>
        <div class="muted">${esc(st.email)} · обновлено ${when}</div></div></div>
      <p class="muted">Задачи и заметки одинаковы на всех устройствах, где ты вошла в этот аккаунт. Изменения появляются за пару секунд.</p>
      <div class="sheet-actions"><button class="btn-ghost danger" data-action="sync-out">Выйти</button><span class="spacer"></span>
        <button class="btn-ghost" data-action="sync-now">Обновить сейчас</button><button class="btn-primary" data-action="sheet-close">Готово</button></div>`;
  } else {
    body = `<p>Войди, чтобы задачи и заметки были одинаковыми на Mac, iPhone и iPad. Используй один и тот же email на всех устройствах.</p>
      <form id="syncForm" class="sync-form">
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required /></label>
        <label class="field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" minlength="6" required placeholder="не меньше 6 символов" /></label>
        ${syncMsg ? `<p class="sync-msg">${syncMsg}</p>` : ''}
        <div class="sheet-actions"><button type="button" class="btn-ghost" data-action="sync-signup">Создать аккаунт</button><span class="spacer"></span>
          <button type="submit" class="btn-primary">Войти</button></div>
      </form>
      <p class="muted small">Задачи, которые уже есть на этом устройстве, не пропадут — они объединятся с облаком.</p>`;
  }
  $('#syncBody').innerHTML = `<div class="sheet-grab"></div><h3>☁️ Синхронизация</h3>${body}`;
  $('#syncForm')?.addEventListener('submit', (e) => { e.preventDefault(); syncAuth('in'); });
}

async function syncAuth(mode) {
  const f = $('#syncForm');
  if (!f.reportValidity()) return;
  const email = f.email.value.trim(), password = f.password.value;
  const btns = $$('button', f);
  btns.forEach((b) => { b.disabled = true; });
  try {
    if (mode === 'in') {
      await sync.signIn(email, password);
      syncMsg = '';
      toast('Синхронизация включена ☁️');
    } else {
      const r = await sync.signUp(email, password);
      syncMsg = r.confirmed ? '' : `Мы отправили письмо на ${esc(email)}. Нажми ссылку в нём (если откроется пустая страница — это нормально), затем вернись сюда и нажми «Войти».`;
      if (r.confirmed) toast('Аккаунт создан, синхронизация включена ☁️');
    }
  } catch (e) {
    const m = String(e.message || e);
    syncMsg = /invalid login/i.test(m) ? 'Неверный email или пароль.'
      : /not confirmed/i.test(m) ? 'Email ещё не подтверждён — открой письмо и нажми ссылку.'
      : /already registered/i.test(m) ? 'Такой аккаунт уже есть — просто нажми «Войти».'
      : /rate limit/i.test(m) ? 'Слишком много писем подряд. Подожди немного и попробуй снова.'
      : `Не получилось: ${esc(m)}`;
  }
  renderSync();
}

/* — Справка — */

function showHelp(kind) {
  const body = kind === 'claude' ? `
    <h3>Задачи из Claude</h3>
    <p><b>Напрямую.</b> В проекте Claude «Lumen — задачи» с подключённым Supabase просто напиши: <em>«завтра в 10 стоматолог, в пятницу сдать отчёт»</em> — Claude сам добавит задачи, и они появятся здесь через пару секунд (нужна включённая синхронизация).</p>
    <p><b>Через буфер обмена</b> — в любом чате с Claude:</p>
    <ol>
      <li>Попроси, например: <em>«Составь список задач на неделю для переезда, по одной на строку, с датами словами»</em>.</li>
      <li>Скопируй ответ и вставь в поле «Новая задача». Каждая строка станет задачей, даты, повторы и #категории распознаются сами.</li>
    </ol>
    <button class="btn-primary" data-action="copy-prompt">Скопировать подсказку для Claude</button>`
    : `
    <h3>Быстрое добавление</h3>
    <p>Пиши как обычно — Lumen сам поймёт:</p>
    <ul class="examples">
      <li><b>завтра в 10</b> позвонить маме <b>!!</b></li>
      <li>отчёт <b>в пятницу</b> <b>#работа</b></li>
      <li>йога <b>по вторникам и четвергам</b> <b>в 19</b> <b>#личное</b></li>
      <li>аренда <b>каждое 5 число</b> · витамины <b>каждый день</b> <b>утром</b></li>
      <li><b>др</b> Оли <b>15.10.1995</b> — день рождения с возрастом</li>
      <li>выучить испанский <b>когда-нибудь</b></li>
    </ul>
    <p><b>!</b> <b>!!</b> <b>!!!</b> — важность · <b>#работа</b> и <b>#личное</b> — категории.</p>
    <h3>Управление</h3>
    <p>Перетаскивай задачи между днями мышкой. На iPhone и iPad — <b>зажми задачу</b>, чтобы перенести, пропустить или удалить. Свайп влево/вправо листает календарь. Микрофон в строке ввода — надиктовать задачу.</p>
    <p><kbd>N</kbd> новая задача · <kbd>/</kbd> поиск · <kbd>1</kbd>–<kbd>4</kbd> вид · <kbd>←</kbd> <kbd>→</kbd> листать · <kbd>T</kbd> сегодня · <kbd>P</kbd> заметки</p>
    <p class="muted">На iPhone и iPad: открой в Safari → «Поделиться» → «На экран Домой».</p>`;
  $('#helpBody').innerHTML = `<div class="sheet-grab"></div>${body}<div class="sheet-actions"><span class="spacer"></span><button class="btn-ghost" data-action="sheet-close">Понятно</button></div>`;
  closeSheets();
  openSheet('#helpSheet');
}

const CLAUDE_PROMPT = 'Пиши задачи списком, каждую с новой строки, без нумерации, в формате: «<когда> <что сделать> <!/!!/!!! если важно> <#работа или #личное>». Даты словами (сегодня, завтра, в пятницу, 15 октября), время — «в 10:30», повторы — «каждый понедельник», «по будням», «каждое 5 число».';

/* ───────────── Быстрое добавление ───────────── */

const qa = $('#qaInput');
const defaultDateKey = () => (view === 'day' ? toKey(cursor) : todayKey());

function renderChips() {
  const v = qa.value.trim();
  if (!v) { $('#qaChips').innerHTML = ''; return; }
  const p = parseQuick(v);
  const dk = p.noDate ? null : p.date || defaultDateKey();
  const chips = [`<span class="qchip${p.date || p.noDate ? ' hit' : ''}">${p.kind === 'birthday' ? '🎂 ' : ''}${esc(shortDate(dk))}</span>`];
  if (p.time) chips.push(`<span class="qchip hit">${p.time}</span>`);
  if (p.repeat && p.kind !== 'birthday') chips.push(`<span class="qchip hit">↻ ${esc(describeRepeat(p.repeat, dk || todayKey()))}</span>`);
  if (p.category) chips.push(`<span class="qchip hit">${CATEGORIES[p.category].emoji}</span>`);
  if (p.priority) chips.push(`<span class="qchip hit p${p.priority}">${'!'.repeat(p.priority)}</span>`);
  $('#qaChips').innerHTML = chips.join('');
}

function quickAdd(text, fallbackKey) {
  const p = parseQuick(text);
  if (!p.title) return null;
  return addTask({ ...p, date: p.noDate ? null : p.date || fallbackKey });
}

function addMany(text, fallbackKey) {
  let n = 0;
  for (const l of text.split(/\r?\n/).map(cleanListLine).filter(Boolean)) if (quickAdd(l, fallbackKey)) n++;
  return n;
}

function pasteHandler(fallback) {
  return (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    const n = addMany(text, fallback());
    render();
    if (n) { toast(`Добавлено задач: ${n} ✨`); burst(innerWidth / 2, innerHeight - 80, 30); }
  };
}

$('#quickAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = qa.value.trim();
  if (!v) { qa.focus(); return; }
  const t = quickAdd(v, defaultDateKey());
  if (!t) return;
  qa.value = '';
  renderChips();
  render();
  flash(t.id);
  toast(t.date ? `Добавлено: ${shortDate(t.date).toLowerCase()}${t.time ? ' в ' + t.time : ''}${t.repeat && t.kind !== 'birthday' ? ' · ' + describeRepeat(t.repeat, t.date) : ''}` : 'Добавлено в «Когда-нибудь» 💭');
});
qa.addEventListener('input', renderChips);
qa.addEventListener('paste', pasteHandler(defaultDateKey));

$('#dayAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#dayAddInput');
  const v = inp.value.trim();
  if (!v || !openDayKey) return;
  const t = quickAdd(v, openDayKey);
  inp.value = '';
  render();
  if (t && t.date !== openDayKey) toast(`Добавлено: ${shortDate(t.date).toLowerCase()}`);
});
$('#dayAddInput').addEventListener('paste', pasteHandler(() => openDayKey));

$('#somedayAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const inp = $('#somedayInput');
  const v = inp.value.trim();
  if (!v) return;
  const p = parseQuick(v);
  if (p.title) addTask({ ...p, date: p.date || null });
  inp.value = '';
  render();
});
$('#somedayInput').addEventListener('paste', pasteHandler(() => null));

function flash(id) {
  requestAnimationFrame(() => $$(`.task[data-id="${id}"]`).forEach((el) => el.classList.add('flash')));
}

/* — Голосовой ввод — */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (SR && isSecureContext) $('#qaMic').hidden = false;

function toggleVoice() {
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.continuous = false;
  const before = qa.value ? qa.value.trim() + ' ' : '';
  rec.onresult = (e) => {
    qa.value = before + [...e.results].map((r) => r[0].transcript).join(' ');
    renderChips();
  };
  rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Разреши доступ к микрофону в настройках браузера'); };
  rec.onend = () => { rec = null; $('#qaMic').classList.remove('live'); qa.focus(); };
  $('#qaMic').classList.add('live');
  rec.start();
}

/* ───────────── Заметки ───────────── */

$('#noteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#noteInput').value.trim();
  if (!text) return;
  db.notes.push({ id: uid(), text, pinned: false, createdAt: Date.now(), updatedAt: Date.now() });
  save();
  $('#noteInput').value = '';
  renderNotes();
});
$('#noteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#noteForm').requestSubmit();
});
$('#noteSearch').addEventListener('input', renderNotes);
$('#notesList').addEventListener('focusout', (e) => {
  const el = e.target.closest('[data-note]');
  if (!el) return;
  const n = db.notes.find((x) => x.id === el.dataset.note);
  const text = el.innerText.trim();
  if (!n || text === n.text) return;
  if (!text) db.notes = db.notes.filter((x) => x !== n);
  else { n.text = text; n.updatedAt = Date.now(); }
  save();
  renderNotes();
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.notes)) throw new Error();
    if (!confirm(`Заменить текущие данные копией? (задач: ${data.tasks.length}, заметок: ${data.notes.length})`)) return;
    db.tasks = data.tasks;
    db.notes = data.notes;
    save();
    render();
    renderNotes();
    toast('Копия восстановлена');
  } catch {
    toast('Это не похоже на копию Lumen');
  }
  e.target.value = '';
});

/* ───────────── Напоминания ───────────── */

const notified = new Set();
function updateRemindLabel() {
  $('#remindLabel').textContent = `Напоминания: ${prefs.remind && 'Notification' in window && Notification.permission === 'granted' ? 'включены' : 'выключены'}`;
}
async function toggleReminders() {
  if (prefs.remind) { prefs.remind = false; savePrefs(); updateRemindLabel(); toast('Напоминания выключены'); return; }
  if (!('Notification' in window)) { toast('Этот браузер не поддерживает уведомления. Напомню внутри приложения.'); return; }
  const perm = await Notification.requestPermission();
  prefs.remind = perm === 'granted';
  savePrefs();
  updateRemindLabel();
  toast(prefs.remind ? 'Напоминания включены 🔔 (пока Lumen открыт)' : 'Уведомления запрещены в настройках браузера');
}
function checkReminders() {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const tk = todayKey();
  for (const it of itemsOn(tk, { filter: false })) {
    if (it.done || it.t.time !== hm) continue;
    const id = it.t.id + tk;
    if (notified.has(id)) continue;
    notified.add(id);
    toast(`🔔 ${it.t.time} · ${it.t.title}`, 6000);
    if (prefs.remind && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(it.t.title, { body: `Lumen · ${it.t.time}`, icon: 'icons/icon-192.png', tag: id }); } catch { /* iOS без PWA */ }
    }
  }
}

/* ───────────── Действия ───────────── */

const actions = {
  toggle: (el) => toggleTask(el.dataset.id, el.dataset.k || null, el),
  edit: (el) => openTask(el.dataset.id, el.dataset.k || null),
  'open-day': (el) => openDay(el.dataset.key),
  'goto-month': (el) => { cursor = new Date(cursor.getFullYear(), +el.dataset.m, 1); setView('month'); },
  'open-day-view': () => { cursor = fromKey(openDayKey); closeSheets(); setView('day'); },
  prev: () => step(-1),
  next: () => step(1),
  today: () => { cursor = fromKey(todayKey()); render(); },
  themes: () => openThemes(),
  'set-theme': (el) => { prefs.theme = el.dataset.theme; savePrefs(); render(); $$('.theme-card').forEach((c) => c.classList.toggle('on', c === el)); },
  notes: () => { prefs.notesOpen = !prefs.notesOpen; savePrefs(); renderLayout(); },
  menu: () => { updateRemindLabel(); openSheet('#menuSheet'); },
  search: () => { closeSheets(); $('#searchInput').value = ''; renderSearch(); openSheet('#searchSheet'); setTimeout(() => $('#searchInput').focus(), 50); },
  'open-note': (el) => { closeSheets(); prefs.notesOpen = true; prefs.panelTab = 'notes'; $('#noteSearch').value = el.dataset.q; savePrefs(); renderLayout(); renderSomeday(); renderNotes(); },
  'sheet-close': () => closeSheets(),
  'save-quotes': () => {
    const before = JSON.stringify(prefs.myQuotes || []);
    prefs.myQuotes = parseMyQuotes($('#myQuotes').value);
    savePrefs();
    closeSheets();
    if (JSON.stringify(prefs.myQuotes) !== before) {
      // сразу показываем одну из своих цитат
      if (prefs.myQuotes.length) {
        const day = Math.floor(fromKey(todayKey()).getTime() / 864e5);
        let shift = 0;
        while (((day + shift) % 3 + 3) % 3 !== 0) shift++;
        prefs.quoteShift = shift;
        savePrefs();
      }
      renderQuote();
      toast(prefs.myQuotes.length ? `Твоих цитат: ${prefs.myQuotes.length} ✨` : 'Свои цитаты убраны');
    }
  },
  filter: (el) => { prefs.filter = el.dataset.cat || null; savePrefs(); render(); },
  'hide-banners': () => { prefs.bannerHidden = todayKey(); savePrefs(); renderBanners(); },
  'quote-next': () => { prefs.quoteShift++; savePrefs(); renderQuote(); },
  brief: () => openBrief(),
  review: () => openReview(),
  reminders: () => toggleReminders(),
  sync: () => { closeSheets(); renderSync(); openSheet('#syncSheet'); },
  'sync-signup': () => syncAuth('up'),
  'sync-now': () => sync?.syncNow(),
  'sync-out': async () => { await sync?.signOut(); toast('Синхронизация выключена. Данные остались на этом устройстве.'); renderSync(); },
  voice: () => toggleVoice(),
  'task-delete': () => { $('#taskSheet').close(); deleteItem(editing.id, editing.k, true); },
  'task-skip': () => { $('#taskSheet').close(); deleteItem(editing.id, editing.k, false); },
  'move-to': (el) => { closeSheets(); moveItem(actionCtx.id, actionCtx.k, targetKey(el.dataset.to)); },
  'act-toggle': () => { closeSheets(); toggleTask(actionCtx.id, actionCtx.k); },
  'act-edit': () => openTask(actionCtx.id, actionCtx.k),
  'act-skip': () => { closeSheets(); deleteItem(actionCtx.id, actionCtx.k, false); },
  'act-delete': () => { closeSheets(); deleteItem(actionCtx.id, actionCtx.k, true); },
  'move-overdue': () => {
    const tk = todayKey();
    const snap = snapshot();
    db.tasks.forEach((t) => { if (!t.repeat && !t.done && t.date && t.date < tk) t.date = tk; });
    save();
    render();
    toastUndo('Перенесено на сегодня', restoreFrom(snap));
  },
  'note-pin': (el) => { const n = db.notes.find((x) => x.id === el.dataset.id); n.pinned = !n.pinned; save(); renderNotes(); },
  'note-del': (el) => {
    const n = db.notes.find((x) => x.id === el.dataset.id);
    db.notes = db.notes.filter((x) => x !== n);
    save();
    renderNotes();
    toastUndo('Заметка удалена', () => { db.notes.push(n); save(); renderNotes(); });
  },
  'note-to-task': (el) => {
    const n = db.notes.find((x) => x.id === el.dataset.id);
    const t = quickAdd(n.text.split('\n')[0], todayKey());
    if (t) { if (n.text.includes('\n')) { t.note = n.text; save(); } render(); toast(`Задача: ${shortDate(t.date).toLowerCase()}`); }
  },
  help: () => showHelp('help'),
  claude: () => showHelp('claude'),
  'copy-prompt': async () => {
    try { await navigator.clipboard.writeText(CLAUDE_PROMPT); toast('Подсказка скопирована'); } catch { toast('Не удалось скопировать'); }
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ app: 'lumen', version: 2, exportedAt: new Date().toISOString(), ...db }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lumen-${todayKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import: () => $('#importFile').click(),
  'clear-done': () => {
    const limit = Date.now() - 30 * 864e5;
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((t) => !(!t.repeat && t.done && t.doneAt && t.doneAt < limit));
    save();
    render();
    toast(`Убрано: ${before - db.tasks.length}`);
  },
};

let suppressClick = false;
document.addEventListener('click', (e) => {
  if (suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
  const seg = e.target.closest('#viewSeg button');
  if (seg) { setView(seg.dataset.view); return; }
  const tab = e.target.closest('#panelTabs button');
  if (tab) { prefs.panelTab = tab.dataset.tab; savePrefs(); renderSomeday(); return; }
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { actions[el.dataset.action](el); return; }
  if (e.target.tagName === 'DIALOG') e.target.close();
}, true);

document.addEventListener('keydown', (e) => {
  const el = e.target.closest?.('.mcell[role="button"]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDay(el.dataset.key); }
});

/* ───────────── Перетаскивание (компьютер) ───────────── */

let dragData = null;
let dropEl = null;
const setDrop = (el) => {
  if (dropEl === el) return;
  dropEl?.classList.remove('drop-hover');
  dropEl = el;
  dropEl?.classList.add('drop-hover');
};
document.addEventListener('dragstart', (e) => {
  const el = e.target.closest?.('[draggable="true"][data-id]');
  if (!el) return;
  dragData = { id: el.dataset.id, k: el.dataset.k || null };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.id);
  el.classList.add('dragging');
  document.body.classList.add('is-dragging');
});
document.addEventListener('dragover', (e) => {
  if (!dragData) return;
  const t = e.target.closest?.('[data-drop]');
  if (t) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  setDrop(t);
});
document.addEventListener('drop', (e) => {
  const t = e.target.closest?.('[data-drop]');
  if (!dragData || !t) return;
  e.preventDefault();
  const to = t.dataset.drop === 'none' ? null : t.dataset.drop;
  const d = dragData;
  setTimeout(() => moveItem(d.id, d.k, to));
});
document.addEventListener('dragend', () => {
  setDrop(null);
  dragData = null;
  document.body.classList.remove('is-dragging');
  $$('.dragging').forEach((x) => x.classList.remove('dragging'));
});

/* ───────────── Долгое нажатие (iPhone/iPad) и правый клик ───────────── */

let lp = null;
document.addEventListener('touchstart', (e) => {
  const el = e.target.closest('[data-id][data-k]:not(.check)');
  if (!el || e.target.closest('.check')) return;
  const t = e.touches[0];
  lp = { x: t.clientX, y: t.clientY, fired: false };
  lp.timer = setTimeout(() => {
    lp.fired = true;
    navigator.vibrate?.(15);
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 300);
    openActions(el.dataset.id, el.dataset.k || null);
  }, 450);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!lp) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - lp.x, t.clientY - lp.y) > 10) { clearTimeout(lp.timer); lp = null; }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!lp) return;
  clearTimeout(lp.timer);
  if (lp.fired) {
    e.preventDefault();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
  }
  lp = null;
});
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-id][data-k]');
  if (!el || e.target.closest('[contenteditable]')) return;
  e.preventDefault();
  openActions(el.dataset.id, el.dataset.k || null);
});

/* ───────────── Клавиатура и свайпы ───────────── */

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.search(); return; }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (e.key === 'Escape' && typing) { document.activeElement.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || $('dialog[open]')) return;
  const k = e.key.toLowerCase();
  // буквы указаны для латинской и русской раскладки (одна и та же клавиша)
  if (k === 'n' || k === 'т') { e.preventDefault(); qa.focus(); }
  else if (k === '/' || k === '.') { e.preventDefault(); actions.search(); }
  else if (['1', '2', '3', '4'].includes(k)) setView(['day', 'week', 'month', 'year'][+k - 1]);
  else if (k === 'arrowleft') step(-1);
  else if (k === 'arrowright') step(1);
  else if (k === 't' || k === 'е') actions.today();
  else if (k === 'p' || k === 'з') actions.notes();
});

let swipe = null;
$('#viewBody').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
}, { passive: true });
$('#viewBody').addEventListener('touchend', (e) => {
  if (!swipe || suppressClick) { swipe = null; return; }
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - swipe.at < 600) step(dx < 0 ? 1 : -1);
  swipe = null;
}, { passive: true });

if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
}

/* ───────────── Тосты ───────────── */

let toastTimer;
function toast(msg, ms = 2000) {
  const el = $('#toast');
  el.innerHTML = esc(msg);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function toastUndo(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `${esc(msg)} <button class="link">Вернуть</button>`;
  el.querySelector('button').onclick = () => { undo(); el.classList.remove('show'); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

/* ───────────── Старт ───────────── */

// раньше было пять категорий — дом, красота и здоровье теперь входят в «Личное»
{
  let moved = false;
  for (const t of db.tasks) if (t.category && !CATEGORIES[t.category]) { t.category = 'personal'; t.updatedAt = Date.now(); moved = true; }
  if (moved) save();
}

// старые версии на iPhone (без https) создавали id не в формате UUID — база такие не примет
{
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let fixed = false;
  for (const x of [...db.tasks, ...db.notes]) if (!UUID.test(x.id)) { x.id = uid(); fixed = true; }
  if (fixed) persist();
}

if (matchMedia('(max-width: 1099px)').matches) prefs.notesOpen = false;
$('[data-pane="someday"]').dataset.drop = 'none';

hydrateIcons();
renderQuote();
renderNotes();
render();

if (prefs.briefAuto && prefs.briefSeen !== todayKey() && new Date().getHours() >= 4) {
  prefs.briefSeen = todayKey();
  savePrefs();
  setTimeout(openBrief, 350);
}

let lastDay = todayKey();
let lastTheme = effectiveTheme();
const tick = () => {
  if (todayKey() !== lastDay) { lastDay = todayKey(); cursor = fromKey(lastDay); renderQuote(); }
  render();
  renderNotes();
};
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
setInterval(() => {
  checkReminders();
  if (todayKey() !== lastDay || effectiveTheme() !== lastTheme) { lastTheme = effectiveTheme(); tick(); }
}, 20_000);
checkReminders();

import('./sync.js')
  .then(async (m) => {
    sync = m;
    await m.initSync({ db, persist, refresh: () => { render(); renderNotes(); }, toast, onStatus: onSyncStatus });
  })
  .catch((e) => { console.warn('Lumen: облако недоступно', e); onSyncStatus({ status: 'off', email: null, lastSync: 0 }); });

if ('serviceWorker' in navigator && isSecureContext) {
  // когда выходит новая версия, один раз перезагружаемся, чтобы показать её
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
