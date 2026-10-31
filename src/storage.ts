// 기기 안 저장소. IndexedDB 관련 코드는 전부 이 파일에만 둔다.
// 나머지 코드는 loadAll / saveAll / putImage / getImage / deleteImage / resetAll / requestPersist만 사용한다.
import {
  type Persisted, DEF_PREFS, PREF_KEYS, zeroPrefsT, seed, normalizeData, purgeTombstones,
  referencedImages, maxStamp, observeClock, clockValue, visibleCats, uid,
} from './model';

const DB_NAME = 'synapse-canvas';
const DB_VERSION = 1;
const KV = 'kv';
const IMAGES = 'images';
const STATE_KEY = 'state';
const LEGACY_KEY = 'synapse-canvas-v1';

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
        if (!d.objectStoreNames.contains(IMAGES)) d.createObjectStore(IMAGES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// ── 이미지 (Blob) ────────────────────────────────────
export const putImage = (id: string, blob: Blob) => tx(IMAGES, 'readwrite', s => { s.put(blob, id); });
export const getImage = (id: string) => tx<Blob | undefined>(IMAGES, 'readonly', s => s.get(id));
export const deleteImage = (id: string) => tx(IMAGES, 'readwrite', s => { s.delete(id); });
export const listImageIds = () => tx<IDBValidKey[]>(IMAGES, 'readonly', s => s.getAllKeys()).then(k => k.map(String));

export async function dataUrlToBlob(src: string): Promise<Blob> {
  return (await fetch(src)).blob();
}
// dataURL을 이미지 저장소에 넣고 새 imageId를 돌려준다 (이전 버전 데이터/백업 가져오기용)
export async function storeDataUrl(src: string, id = uid()): Promise<string | null> {
  try { await putImage(id, await dataUrlToBlob(src)); return id; } catch { return null; }
}

// ── 상태 ─────────────────────────────────────────────
// 저장 실패(용량 초과 등)는 예외로 올려 보내 상태 표시를 오류로 바꾸게 한다.
export const saveAll = (p: Persisted) => tx(KV, 'readwrite', s => { s.put({ ...p, clock: Math.max(p.clock, clockValue()) }, STATE_KEY); });

function finish(p: Persisted): Persisted {
  observeClock(Math.max(p.clock || 0, maxStamp(p.data)));
  const data = purgeTombstones(p.data);
  const vis = visibleCats(data);
  const active = vis.some(c => c.id === p.active) ? p.active : vis[0]?.id ?? '';
  return {
    ...p, schema: 2, data, active,
    prefs: { ...DEF_PREFS, ...p.prefs },
    prefsT: { ...zeroPrefsT(), ...p.prefsT },
    views: p.views || {}, clock: clockValue(),
  };
}

// localStorage의 이전 버전(synapse-canvas-v1) 데이터를 처음 한 번 IndexedDB로 옮긴다.
// 원본은 지우지 않고 남겨 둔다(만일을 위한 백업). IndexedDB에 데이터가 생기면 다시 실행되지 않는다.
async function migrateLegacy(): Promise<Persisted | null> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || !o.data || !Array.isArray(o.data.cats) || !o.data.cats.length) return null;
    const data = await normalizeData(o.data, src => storeDataUrl(src));
    const prefs = { ...DEF_PREFS };
    for (const k of PREF_KEYS) if (o.prefs && k in o.prefs) (prefs as Record<string, unknown>)[k] = o.prefs[k];
    const views: Persisted['views'] = {};
    for (const c of o.data.cats) if (c && c.view) views[String(c.id)] = c.view;
    return { schema: 2, data, prefs, prefsT: zeroPrefsT(), views, active: String(o.data.active ?? ''), clock: 0 };
  } catch { return null; }
}

// 이 기기의 전체 상태를 읽는다. 처음이면 이전 데이터 이전 또는 초기 데이터 생성.
// 참조되지 않는 이미지 Blob은 시작 시 정리한다(실행 취소 히스토리는 메모리에만 있으므로 시작 시점이 안전).
export async function loadAll(): Promise<{ state: Persisted; fresh: boolean }> {
  const saved = await tx<Persisted | undefined>(KV, 'readonly', s => s.get(STATE_KEY));
  let state: Persisted, fresh = false;
  if (saved && saved.data && Array.isArray(saved.data.cats)) state = finish(saved);
  else {
    const legacy = await migrateLegacy();
    state = finish(legacy || { schema: 2, data: seed(), prefs: { ...DEF_PREFS }, prefsT: zeroPrefsT(), views: {}, active: '', clock: 0 });
    fresh = !legacy;
    await saveAll(state);
  }
  try {
    const used = referencedImages(state.data);
    for (const id of await listImageIds()) if (!used.has(id)) await deleteImage(id);
  } catch { /* 정리는 실패해도 무방 */ }
  return { state, fresh };
}

// 이 기기의 맵·사진을 모두 지우고 초기 예시 데이터로 (로그아웃의 "이 기기 데이터도 지우기").
// 비워 두기만 하면 다음 시작 때 이전 버전(localStorage) 데이터를 다시 옮겨 오므로 초기 데이터를 바로 써 둔다.
export async function resetAll(): Promise<void> {
  await tx(IMAGES, 'readwrite', s => { s.clear(); });
  await saveAll(finish({ schema: 2, data: seed(), prefs: { ...DEF_PREFS }, prefsT: zeroPrefsT(), views: {}, active: '', clock: 0 }));
}

// 브라우저가 저장소를 임의로 비우지 않도록 영구 저장 요청 (첫 실행 시)
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}
