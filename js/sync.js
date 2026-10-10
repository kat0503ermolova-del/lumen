// Синхронизация через Supabase: локальные данные остаются основными,
// изменения отправляются в облако и приходят с других устройств в реальном времени.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://peuvobnwxmdqmhyicrrk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_mPnOaIsJd8BAaFeVgV-GYw_62Iro77i';
const SHADOW_KEY = 'lumen.shadow.v1';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lumen.auth' },
});

let api = null;      // { db, persist, refresh, toast, onStatus }
let user = null;
let channel = null;
let shadow = { t: {}, n: {} };
let pushing = false;
let pendingPush = false;
let pushTimer = null;
let lastSync = 0;
let status = 'off';  // off | syncing | ok | error

/* ───────── Нормализация: одна и та же форма для сравнения ───────── */

const canonTask = (t) => ({
  id: t.id, title: t.title, note: t.note || '', date: t.date || null, time: t.time ? t.time.slice(0, 5) : null,
  priority: t.priority || 0, category: t.category || null, kind: t.kind || 'task', birthYear: t.birthYear || null,
  repeat: t.repeat || null, done: !!t.done, doneAt: t.doneAt || null, doneDates: t.doneDates || {}, skip: t.skip || [],
  createdAt: t.createdAt || 0,
});
const canonNote = (n) => ({ id: n.id, text: n.text, pinned: !!n.pinned, createdAt: n.createdAt || 0 });
// подпись объекта с отсортированными ключами: jsonb в базе меняет порядок ключей
const stable = (v) => (Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const sig = (o) => JSON.stringify(stable(o));

const taskToRow = (t) => ({
  id: t.id, user_id: user.id, title: t.title, note: t.note || '', date: t.date || null, time: t.time || null,
  priority: t.priority || 0, category: t.category || null, kind: t.kind || 'task', birth_year: t.birthYear || null,
  repeat: t.repeat || null, done: !!t.done, done_at: t.doneAt ? new Date(t.doneAt).toISOString() : null,
  done_dates: t.doneDates || {}, skip: t.skip || [],
  created_at: new Date(t.createdAt || Date.now()).toISOString(), updated_at: new Date(t.updatedAt || Date.now()).toISOString(),
});
const rowToTask = (r) => ({
  ...canonTask({
    id: r.id, title: r.title, note: r.note, date: r.date, time: r.time, priority: r.priority, category: r.category,
    kind: r.kind, birthYear: r.birth_year, repeat: r.repeat, done: r.done, doneAt: r.done_at ? Date.parse(r.done_at) : null,
    doneDates: r.done_dates, skip: r.skip, createdAt: Date.parse(r.created_at),
  }),
  updatedAt: Date.parse(r.updated_at),
});
const noteToRow = (n) => ({
  id: n.id, user_id: user.id, text: n.text, pinned: !!n.pinned,
  created_at: new Date(n.createdAt || Date.now()).toISOString(), updated_at: new Date(n.updatedAt || Date.now()).toISOString(),
});
const rowToNote = (r) => ({ ...canonNote({ id: r.id, text: r.text, pinned: r.pinned, createdAt: Date.parse(r.created_at) }), updatedAt: Date.parse(r.updated_at) });

const KINDS = {
  t: { table: 'planner_tasks', list: () => api.db.tasks, set: (v) => { api.db.tasks = v; }, canon: canonTask, toRow: taskToRow, fromRow: rowToTask },
  n: { table: 'planner_notes', list: () => api.db.notes, set: (v) => { api.db.notes = v; }, canon: canonNote, toRow: noteToRow, fromRow: rowToNote },
};

/* ───────── Служебное ───────── */

function loadShadow() {
  try { shadow = JSON.parse(localStorage.getItem(SHADOW_KEY)) || { t: {}, n: {} }; } catch { shadow = { t: {}, n: {} }; }
  if (shadow.user !== user?.id) shadow = { user: user?.id, t: {}, n: {} };
}
function saveShadow() {
  try { localStorage.setItem(SHADOW_KEY, JSON.stringify(shadow)); } catch { /* память недоступна */ }
}
function setStatus(s) {
  status = s;
  api.onStatus?.(getState());
}
export function getState() {
  return { status, email: user?.email || null, lastSync };
}

/* ───────── Полная синхронизация (при входе и возвращении в приложение) ───────── */

async function fullSync() {
  if (!user) return;
  setStatus('syncing');
  try {
    for (const [code, K] of Object.entries(KINDS)) {
      const { data, error } = await sb.from(K.table).select('*');
      if (error) throw error;
      const remote = new Map(data.map((r) => [r.id, K.fromRow(r)]));
      const local = new Map(K.list().map((x) => [x.id, x]));
      const result = [];
      const toDelete = [];

      for (const [id, r] of remote) {
        const l = local.get(id);
        if (!l) {
          if (shadow[code][id]) toDelete.push(id);       // удалено на этом устройстве, пока не было сети
          else { result.push(r); shadow[code][id] = sig(K.canon(r)); }
          continue;
        }
        const localChanged = sig(K.canon(l)) !== shadow[code][id];
        if (localChanged && (l.updatedAt || 0) > r.updatedAt) result.push(l); // локальная правка новее — отправим
        else { result.push(r); shadow[code][id] = sig(K.canon(r)); }
      }
      for (const [id, l] of local) {
        if (remote.has(id)) continue;
        if (shadow[code][id]) delete shadow[code][id];   // удалено на другом устройстве
        else result.push(l);                             // новое на этом устройстве — отправим
      }
      K.set(result);
      if (toDelete.length) {
        const { error: delErr } = await sb.from(K.table).delete().in('id', toDelete);
        if (delErr) throw delErr;
        toDelete.forEach((id) => delete shadow[code][id]);
      }
    }
    saveShadow();
    api.persist();
    api.refresh();
    await push(true);
    lastSync = Date.now();
    setStatus('ok');
  } catch (e) {
    console.warn('Lumen sync:', e);
    setStatus('error');
  }
}

/* ───────── Отправка локальных изменений ───────── */

export function schedule() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(), 700);
}

async function push(inner = false) {
  if (!user) return;
  if (pushing) { pendingPush = true; return; }
  pushing = true;
  if (!inner) setStatus('syncing');
  const now = Date.now();
  let touched = false;
  try {
    for (const [code, K] of Object.entries(KINDS)) {
      const up = [];
      const ids = new Set();
      for (const x of K.list()) {
        ids.add(x.id);
        const s = sig(K.canon(x));
        if (shadow[code][x.id] !== s) {
          if (!x.updatedAt || shadow[code][x.id]) { x.updatedAt = now; touched = true; }
          up.push([x, s]);
        }
      }
      const del = Object.keys(shadow[code]).filter((id) => !ids.has(id));
      if (up.length) {
        const { error } = await sb.from(K.table).upsert(up.map(([x]) => K.toRow(x)));
        if (error) throw error;
        up.forEach(([x, s]) => { shadow[code][x.id] = s; });
      }
      if (del.length) {
        const { error } = await sb.from(K.table).delete().in('id', del);
        if (error) throw error;
        del.forEach((id) => delete shadow[code][id]);
      }
    }
    saveShadow();
    if (touched) api.persist();
    lastSync = Date.now();
    if (!inner) setStatus('ok');
  } catch (e) {
    console.warn('Lumen push:', e);
    setStatus('error');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(), 15_000); // повторим, когда появится сеть
  } finally {
    pushing = false;
    if (pendingPush) { pendingPush = false; schedule(); }
  }
}

/* ───────── Изменения с других устройств ───────── */

function onRemote(code, payload) {
  const K = KINDS[code];
  if (payload.eventType === 'DELETE') {
    const id = payload.old?.id;
    if (!id) return;
    const had = K.list().some((x) => x.id === id);
    K.set(K.list().filter((x) => x.id !== id));
    delete shadow[code][id];
    saveShadow();
    if (had) { api.persist(); api.refresh(); }
    return;
  }
  const r = K.fromRow(payload.new);
  const s = sig(K.canon(r));
  if (shadow[code][r.id] === s) return; // это наше же изменение вернулось эхом
  const list = K.list();
  const i = list.findIndex((x) => x.id === r.id);
  if (i >= 0) {
    const l = list[i];
    const localChanged = sig(K.canon(l)) !== shadow[code][r.id];
    if (localChanged && (l.updatedAt || 0) > r.updatedAt) return; // у нас правка свежее
    list[i] = r;
  } else {
    list.push(r);
  }
  shadow[code][r.id] = s;
  saveShadow();
  api.persist();
  api.refresh();
}

function subscribe() {
  unsubscribe();
  channel = sb.channel('lumen-' + user.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planner_tasks', filter: `user_id=eq.${user.id}` }, (p) => onRemote('t', p))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planner_notes', filter: `user_id=eq.${user.id}` }, (p) => onRemote('n', p))
    .subscribe();
}
function unsubscribe() {
  if (channel) { sb.removeChannel(channel); channel = null; }
}

/* ───────── Вход / выход ───────── */

async function setUser(u) {
  const changed = u?.id !== user?.id;
  user = u;
  if (!user) { unsubscribe(); setStatus('off'); return; }
  if (!changed) return;
  loadShadow();
  subscribe();
  await fullSync();
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await setUser(data.user);
}

export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
  if (data.session) { await setUser(data.user); return { confirmed: true }; }
  return { confirmed: false };
}

export async function signOut() {
  await sb.auth.signOut();
  shadow = { t: {}, n: {} };
  try { localStorage.removeItem(SHADOW_KEY); } catch { /* ignore */ }
  await setUser(null);
}

export const syncNow = () => fullSync();

export async function initSync(appApi) {
  api = appApi;
  sb.auth.onAuthStateChange((_event, session) => { setUser(session?.user || null); });
  const { data } = await sb.auth.getSession();
  await setUser(data.session?.user || null);
  // после сна вкладки или потери сети догоняем изменения
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user && Date.now() - lastSync > 30_000) fullSync();
  });
  addEventListener('online', () => { if (user) fullSync(); });
}
