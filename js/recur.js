// Повторяющиеся задачи: попадает ли задача на конкретный день

import { fromKey } from './parse.js';

const DAY = 864e5;
const dnum = (k) => Math.round(fromKey(k).getTime() / DAY);
const weekIndex = (k) => Math.floor((dnum(k) - ((fromKey(k).getDay() + 6) % 7)) / 7);
const lastDay = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export function occursOn(t, k) {
  if (!t.date) return false;
  if (!t.repeat) return t.date === k;
  if (k < t.date) return false;
  if (t.skip?.includes(k)) return false;
  if (t.repeat.until && k > t.repeat.until) return false;
  const r = t.repeat;
  const n = r.interval || 1;
  const a = fromKey(t.date);
  const b = fromKey(k);
  switch (r.freq) {
    case 'day':
      return (dnum(k) - dnum(t.date)) % n === 0;
    case 'week': {
      const days = r.days?.length ? r.days : [a.getDay()];
      if (!days.includes(b.getDay())) return false;
      return (weekIndex(k) - weekIndex(t.date)) % n === 0;
    }
    case 'month': {
      const md = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      if (md % n) return false;
      return b.getDate() === Math.min(a.getDate(), lastDay(b));
    }
    case 'year': {
      if ((b.getFullYear() - a.getFullYear()) % n || b.getMonth() !== a.getMonth()) return false;
      return b.getDate() === Math.min(a.getDate(), lastDay(b));
    }
  }
  return false;
}

const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export function describeRepeat(r, startKey) {
  if (!r) return '';
  const n = r.interval || 1;
  if (r.freq === 'day') return n === 1 ? 'каждый день' : `каждые ${n} дн.`;
  if (r.freq === 'week') {
    const days = r.days?.length ? r.days : [fromKey(startKey).getDay()];
    const set = [...days].sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7));
    if (n === 1 && set.join() === '1,2,3,4,5') return 'по будням';
    if (n === 1 && set.length === 2 && set.includes(6) && set.includes(0)) return 'по выходным';
    if (set.length === 7) return 'каждый день';
    const list = set.map((d) => WD_SHORT[d]).join(', ');
    return n === 1 ? `каждый ${list}` : `раз в ${n} нед. (${list})`;
  }
  if (r.freq === 'month') {
    const d = fromKey(startKey).getDate();
    return n === 1 ? `каждое ${d}-е число` : `раз в ${n} мес., ${d}-го`;
  }
  if (r.freq === 'year') return 'каждый год';
  return '';
}

// Пресеты для формы редактирования
export const REPEAT_PRESETS = [
  ['none', 'Не повторять', null],
  ['day', 'Каждый день', { freq: 'day', interval: 1 }],
  ['weekdays', 'По будням', { freq: 'week', interval: 1, days: [1, 2, 3, 4, 5] }],
  ['week', 'Каждую неделю', { freq: 'week', interval: 1 }],
  ['week2', 'Раз в 2 недели', { freq: 'week', interval: 2 }],
  ['month', 'Каждый месяц', { freq: 'month', interval: 1 }],
  ['year', 'Каждый год', { freq: 'year', interval: 1 }],
];

export function presetOf(r) {
  if (!r) return 'none';
  if (r.freq === 'week' && r.days?.join() === '1,2,3,4,5' && (r.interval || 1) === 1) return 'weekdays';
  if (r.freq === 'week' && (r.interval || 1) === 2) return 'week2';
  if (r.freq === 'week') return 'week';
  if (r.freq === 'day' && (r.interval || 1) === 1) return 'day';
  if (r.freq === 'month') return 'month';
  if (r.freq === 'year') return 'year';
  return 'custom';
}
