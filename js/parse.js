// Разбор быстрого ввода на русском: «завтра в 10 позвонить маме !! #работа»

const pad = (n) => String(n).padStart(2, '0');
export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const END = '(?=\\s|$|[,.!?;])';
const MONTHS = { янв: 0, фев: 1, мар: 2, апр: 3, май: 4, мая: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
const WEEKDAYS = [
  [/^(пн|пон)/, 1], [/^вт/, 2], [/^ср/, 3], [/^(чт|чет)/, 4],
  [/^(пт|пят)/, 5], [/^(сб|суб)/, 6], [/^(вс|вос)/, 0],
];
const WD = '(?:понедельник[а-яё]*|вторник[а-яё]*|сред[а-яё]*|четверг[а-яё]*|пятниц[а-яё]*|суббот[а-яё]*|воскресень[а-яё]*|пн|вт|ср|чт|пт|сб|вс)';
const wdIndex = (w) => WEEKDAYS.find(([re]) => re.test(w.toLowerCase()))[1];

export const CATEGORY_TAGS = [
  [/^(раб|work|офис)/, 'work'],
  [/^(дом|быт)/, 'home'],
  [/^(лич|себ|я$)/, 'personal'],
  [/^(крас|уход|бьюти)/, 'beauty'],
  [/^(здор|спорт|фит)/, 'health'],
];

export function parseQuick(input, base = new Date()) {
  const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  let s = ` ${input} `;
  let date = null;
  let time = null;
  let priority = 0;
  let category = null;
  let repeat = null;
  let kind = 'task';
  let birthYear = null;
  let noDate = false;
  let monthDay = null;

  const take = (re, fn) => {
    const m = s.match(re);
    if (!m) return false;
    if (fn(m) === false) return false;
    s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length);
    return true;
  };

  // Приоритет: ! !! !!!
  take(/\s(!{1,3})(?=\s)/, (m) => { priority = m[1].length; });

  // Категория: #работа #дом …
  take(/\s#([а-яёa-z]+)/i, (m) => {
    const tag = m[1].toLowerCase();
    const hit = CATEGORY_TAGS.find(([re]) => re.test(tag));
    if (hit) category = hit[1];
  });

  // Без даты
  take(new RegExp(`\\s(когда-?\\s?нибудь|без\\s+даты)${END}`, 'i'), () => { noDate = true; });

  // День рождения
  take(new RegExp(`\\s(др|д\\.р\\.|день\\s+рождения|днюха|🎂)${END}`, 'i'), () => { kind = 'birthday'; });

  // Время: «в 10:30», «к 9.15», «18:00»
  take(new RegExp(`\\s[вк]\\s*(\\d{1,2})[:.](\\d{2})${END}`, 'i'), (m) => {
    if (+m[1] > 23 || +m[2] > 59) return false;
    time = `${pad(+m[1])}:${m[2]}`;
  }) || take(new RegExp(`\\s(\\d{1,2}):(\\d{2})${END}`), (m) => {
    if (+m[1] > 23 || +m[2] > 59) return false;
    time = `${pad(+m[1])}:${m[2]}`;
  });

  // Повторы
  const rep = [
    [`\\s(каждый\\s+день|ежедневно)`, () => ({ freq: 'day', interval: 1 })],
    [`\\sкажды[ейя]\\s+(\\d+|два|две|три)\\s+(дн[а-яё]*|день|недел[а-яё]*|месяц[а-яё]*)`, (m) => {
      const n = { два: 2, две: 2, три: 3 }[m[1]] || +m[1];
      const u = m[2].toLowerCase();
      return { freq: /^недел/.test(u) ? 'week' : /^месяц/.test(u) ? 'month' : 'day', interval: n };
    }],
    [`\\s(по\\s+будням|каждый\\s+будний\\s+день|в\\s+будни)`, () => ({ freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] })],
    [`\\s(по\\s+выходным|каждые\\s+выходные)`, () => ({ freq: 'week', interval: 1, days: [6, 0] })],
    [`\\s(каждую\\s+неделю|еженедельно|раз\\s+в\\s+неделю)`, () => ({ freq: 'week', interval: 1 })],
    [`\\s(каждый\\s+месяц|ежемесячно|раз\\s+в\\s+месяц)`, () => ({ freq: 'month', interval: 1 })],
    [`\\sкаждое\\s+(\\d{1,2})(?:-?[ео]|-?го)?(?:\\s+число)?`, (m) => {
      const d = +m[1];
      if (d < 1 || d > 31) return false;
      monthDay = d;
      return { freq: 'month', interval: 1 };
    }],
    [`\\s(каждый\\s+год|ежегодно|раз\\s+в\\s+год)`, () => ({ freq: 'year', interval: 1 })],
    [`\\s(?:каждый|каждую|каждое|по)\\s+(${WD}(?:(?:\\s*,\\s*|\\s+и\\s+)${WD})*)`, (m) => {
      const days = m[1].split(/\s*,\s*|\s+и\s+/).filter(Boolean).map(wdIndex);
      return { freq: 'week', interval: 1, days: [...new Set(days)] };
    }],
  ];
  for (const [src, fn] of rep) {
    if (take(new RegExp(src + END, 'i'), (m) => { const r = fn(m); if (!r) return false; repeat = r; })) break;
  }

  // Слова-даты
  for (const [w, n] of [['послезавтра', 2], ['завтра', 1], ['сегодня', 0]]) {
    if (take(new RegExp(`\\s${w}${END}`, 'i'), () => { date = addDays(today, n); })) break;
  }

  if (!date) take(new RegExp(`\\sна\\s+выходных${END}`, 'i'), () => {
    date = addDays(today, (6 - today.getDay() + 7) % 7 || 7);
  });
  if (!date) take(new RegExp(`\\sна\\s+следующей\\s+неделе${END}`, 'i'), () => {
    date = addDays(today, ((1 - today.getDay() + 7) % 7) || 7);
  });

  // «15 октября», «3 янв 1990»
  let explicitYear = null;
  if (!date) take(new RegExp(`\\s(\\d{1,2})\\s+(янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\\.?(?:\\s+(\\d{4}))?${END}`, 'i'), (m) => {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    explicitYear = m[3] ? +m[3] : null;
    date = new Date(explicitYear ?? today.getFullYear(), mon, +m[1]);
  });

  // «15.10», «15.10.1990», «15/10»
  if (!date) take(new RegExp(`\\s(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${END}`), (m) => {
    const dd = +m[1], mm = +m[2];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    explicitYear = m[3] ? (+m[3] < 100 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3]) : null;
    date = new Date(explicitYear ?? today.getFullYear(), mm - 1, dd);
  });

  // Без года — ближайшая будущая дата
  if (date && explicitYear === null && date < today && !repeat) {
    date = new Date(date.getFullYear() + 1, date.getMonth(), date.getDate());
  }

  // «через 3 дня», «через неделю», «через месяц»
  if (!date) take(new RegExp(`\\sчерез\\s+(\\d+|пару|неделю|месяц|год)(?:\\s+(дн[а-яё]*|день|недел[а-яё]*|месяц[а-яё]*|год[а-яё]*|лет))?${END}`, 'i'), (m) => {
    const q = m[1].toLowerCase();
    const unit = (m[2] || '').toLowerCase();
    const n = q === 'пару' ? 2 : /^\d+$/.test(q) ? +q : 1;
    const u = /^недел/.test(q) || /^недел/.test(unit) ? 'w'
      : /^месяц/.test(q) || /^месяц/.test(unit) ? 'm'
      : /^год/.test(q) || /^(год|лет)/.test(unit) ? 'y' : 'd';
    if (u === 'd') date = addDays(today, n);
    if (u === 'w') date = addDays(today, n * 7);
    if (u === 'm') date = new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
    if (u === 'y') date = new Date(today.getFullYear() + n, today.getMonth(), today.getDate());
  });

  // «в пятницу», «пн», «в следующий вторник»
  if (!date) take(new RegExp(`\\s(?:(?:в|во|на|к)\\s+)?(следующ[а-яё]*\\s+)?(понедельник[а-яё]*|вторник[а-яё]*|сред[ауы]|четверг[а-яё]*|пятниц[ауы]|суббот[ауы]|воскресень[еяю]|пн|вт|ср|чт|пт|сб|вс)${END}`, 'i'), (m) => {
    let diff = (wdIndex(m[2]) - today.getDay() + 7) % 7;
    if (m[1] && diff === 0) diff = 7;
    date = addDays(today, diff);
  });

  // Время без минут: «в 10», «в 7 вечера», «к 9 утра»
  if (!time) take(new RegExp(`\\s[вк]\\s+(\\d{1,2})(?:\\s*(утра|дня|вечера|ночи|ч\\.?|час[а-яё]*))?${END}`, 'i'), (m) => {
    let h = +m[1];
    if (h > 23) return false;
    const part = (m[2] || '').toLowerCase();
    if ((part === 'дня' || part === 'вечера') && h < 12) h += 12;
    if (part === 'ночи' && h === 12) h = 0;
    time = `${pad(h)}:00`;
  });

  // «утром», «днём», «вечером»
  if (!time) {
    for (const [w, t] of [['утром', '09:00'], ['дн[её]м', '13:00'], ['вечером', '19:00']]) {
      if (take(new RegExp(`\\s${w}${END}`, 'i'), () => { time = t; })) break;
    }
  }

  // Повтор без даты — ставим ближайшее подходящее число
  if (repeat && !date) {
    if (repeat.freq === 'week' && repeat.days) {
      let d = today;
      while (!repeat.days.includes(d.getDay())) d = addDays(d, 1);
      date = d;
    } else if (monthDay) {
      date = new Date(today.getFullYear(), today.getMonth(), monthDay);
      if (date < today) date = new Date(today.getFullYear(), today.getMonth() + 1, monthDay);
    } else {
      date = today;
    }
  }

  // День рождения: повтор каждый год, год рождения отдельно
  if (kind === 'birthday') {
    repeat = { freq: 'year', interval: 1 };
    if (date) {
      if (explicitYear && explicitYear < today.getFullYear()) birthYear = explicitYear;
      let next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
      if (next < today) next = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
      date = next;
    }
  }

  let title = s.replace(/\s+/g, ' ').trim();
  if (kind === 'birthday' && title && !/рожден/i.test(title)) title = `День рождения ${title}`;
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return { title, date: date ? toKey(date) : null, time, priority, category, repeat, kind, birthYear, noDate };
}

// Очищает строку из списка: «- [ ] задача», «1. задача», «• задача»
export function cleanListLine(line) {
  return line
    .replace(/^\s*(?:[-*•–—]\s*)?(?:\[[ xх]?\]\s*)?(?:\d+[.)]\s*)?/i, '')
    .trim();
}
