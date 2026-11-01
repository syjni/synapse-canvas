import { PALETTE } from './lib/color';
import SEED_TEXT from './i18n/seed.json';

// ── 타입 ─────────────────────────────────────────────
// 모든 항목은 updatedAt/deletedAt을 가진다. 삭제는 deletedAt만 기록(툼스톤)하고 화면에서 숨긴다.
// 2단계 동기화에서 항목 단위로 updatedAt이 큰 쪽을 채택하기 위한 준비.
export type Stamp = { updatedAt: number; deletedAt: number | null };
export type Box = Stamp & {
  id: string; type: 'text' | 'image'; x: number; y: number; w: number; h: number;
  text?: string; imageId?: string; head?: string | null;
};
export type Link = Stamp & { id: string; a: string; b: string };
export type Stroke = Stamp & { id: string; color: string; width: number; pts: [number, number][] };
// Category.updatedAt은 카테고리 자체 필드(name/order/deletedAt)의 변경 시각. 하위 항목은 각자 updatedAt을 가진다.
export type Category = Stamp & { id: string; name: string; order: number; boxes: Box[]; links: Link[]; strokes: Stroke[] };
export type Data = { cats: Category[] };
export type View = { x: number; y: number; z: number };

export type Prefs = {
  nodeColor: string; edgeColor: string; linked: boolean; penColor: string;
  penWidth: number; grain: number; pulse: boolean;
};
export type PrefsT = Record<keyof Prefs, number>;

// 저장소에 그대로 들어가는 형태. views/active는 기기 로컬 전용(동기화 대상 아님).
export type Persisted = {
  schema: 2; data: Data; prefs: Prefs; prefsT: PrefsT;
  views: Record<string, View>; active: string; clock: number;
};

export const DEF_PREFS: Prefs = { nodeColor: PALETTE[5].hex, edgeColor: PALETTE[6].hex, linked: false, penColor: '#ECECF6', penWidth: 3, grain: 22, pulse: true };
export const PREF_KEYS = Object.keys(DEF_PREFS) as (keyof Prefs)[];
export const zeroPrefsT = (): PrefsT => Object.fromEntries(PREF_KEYS.map(k => [k, 0])) as PrefsT;

export const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000;

// ── 단조 증가 시계 ───────────────────────────────────
// Date.now()가 뒤로 가도(시계 조정 등) 이 기기에서 본 가장 큰 값 + 1 아래로 내려가지 않는다.
let clock = 0;
export const tick = () => { clock = Math.max(Date.now(), clock + 1); return clock; };
export const observeClock = (t: number) => { if (t > clock) clock = t; };
export const clockValue = () => clock;

export const uid = () => Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);

// ── 조회 헬퍼 ────────────────────────────────────────
export const alive = <T extends Stamp>(x: T) => x.deletedAt == null;
export const visibleCats = (d: Data) => d.cats.filter(alive).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
export const liveBoxes = (c: Category) => c.boxes.filter(alive);
// 양 끝 상자 중 하나라도 삭제 상태면 연결선도 숨김
export const liveLinks = (c: Category) => {
  const ids = new Set(liveBoxes(c).map(b => b.id));
  return c.links.filter(l => alive(l) && ids.has(l.a) && ids.has(l.b));
};
export const liveStrokes = (c: Category) => c.strokes.filter(alive);

// ── 초기 데이터 (dc.html seed()) ─────────────────────
// 예시 상자 글은 처음 실행한 기기의 언어로 (카테고리 이름 Mind·Ideas…는 원래 영어라 그대로).
// 손대지 않은 예시인지 판단할 때(join·merge)는 모든 언어의 예시와 비교한다.
export type SeedLang = keyof typeof SEED_TEXT;
export const SEED_LANGS = Object.keys(SEED_TEXT) as SeedLang[];
export function seed(lang: string = 'ko'): Data {
  const tx: Record<string, string> = SEED_TEXT[(lang in SEED_TEXT ? lang : 'ko') as SeedLang];
  const t = tick();
  const st = { updatedAt: t, deletedAt: null };
  const box = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, type: 'text', x, y, w, h, text: tx[id], ...st });
  let order = 0;
  const mk = (name: string, boxes: Box[] = [], links: [string, string][] = []): Category => ({
    id: uid(), name, order: ++order, boxes, links: links.map(([a, b]) => ({ id: uid(), a, b, ...st })), strokes: [], ...st,
  });
  return {
    cats: [
      mk('Mind', [
        box('m1', -130, -70, 250, 120),
        box('m2', 260, -250, 230, 150),
        box('m3', 280, 110, 230, 110),
        box('m4', -520, 80, 220, 140),
      ], [['m1', 'm2'], ['m1', 'm3'], ['m1', 'm4']]),
      mk('Ideas', [
        box('i1', -140, -60, 270, 110),
        box('i2', 300, -220, 230, 150),
        box('i3', 300, 120, 240, 130),
      ], [['i1', 'i2'], ['i1', 'i3']]),
      mk('Schedule', [
        box('s1', -130, -90, 260, 180),
      ]),
      mk('Custom 1'), mk('Custom 2'), mk('Custom 3'),
    ],
  };
}

// ── 변경 자동 스탬프 ─────────────────────────────────
// 화면 코드는 불변 업데이트만 하고, 참조가 바뀐 항목에 여기서 updatedAt을 찍는다.
function stampList<T extends Stamp & { id: string }>(prev: T[], next: T[]): T[] {
  if (prev === next) return next;
  const old = new Map(prev.map(x => [x.id, x]));
  let changed = false;
  const out = next.map(x => {
    if (old.get(x.id) === x) return x;
    changed = true;
    return { ...x, updatedAt: tick() };
  });
  return changed ? out : next;
}
export function stampChanges(prev: Data, next: Data): Data {
  if (prev === next) return next;
  const old = new Map(prev.cats.map(c => [c.id, c]));
  return {
    ...next,
    cats: next.cats.map(c => {
      const o = old.get(c.id);
      if (o === c) return c;
      const self = !o || o.name !== c.name || o.order !== c.order || o.deletedAt !== c.deletedAt;
      return {
        ...c,
        updatedAt: self ? tick() : c.updatedAt,
        boxes: stampList(o ? o.boxes : [], c.boxes),
        links: stampList(o ? o.links : [], c.links),
        strokes: stampList(o ? o.strokes : [], c.strokes),
      };
    }),
  };
}

// ── 목표 상태로 되돌리기 (실행 취소·가져오기 공통) ────
// target에 없는 항목은 삭제 처리하고, 나머지는 target 내용으로 바꾼다. 결과는 stampChanges로 새 updatedAt을 받는다.
function targetList<T extends Stamp & { id: string }>(cur: T[], target: T[], now: () => number): T[] {
  const ids = new Set(target.map(x => x.id));
  const extra = cur.filter(x => !ids.has(x.id)).map(x => (x.deletedAt == null ? { ...x, deletedAt: now() } : x));
  const curMap = new Map(cur.map(x => [x.id, x]));
  // 내용이 같은 항목은 현재 객체를 그대로 써서 불필요한 스탬프를 막는다
  const same = (a: T, b: T) => JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
  return [...target.map(x => { const c = curMap.get(x.id); return c && same(c, x) ? c : x; }), ...extra];
}
export function applyTarget(cur: Data, target: Data): Data {
  const now = tick;
  const tIds = new Set(target.cats.map(c => c.id));
  const curMap = new Map(cur.cats.map(c => [c.id, c]));
  const cats = target.cats.map(t => {
    const c = curMap.get(t.id);
    if (!c) return t;
    if (c === t) return c;
    const boxes = targetList(c.boxes, t.boxes, now), links = targetList(c.links, t.links, now), strokes = targetList(c.strokes, t.strokes, now);
    const selfSame = c.name === t.name && c.order === t.order && c.deletedAt === t.deletedAt;
    return { ...(selfSame ? c : t), boxes, links, strokes };
  });
  const extra = cur.cats.filter(c => !tIds.has(c.id)).map(c => (c.deletedAt == null ? { ...c, deletedAt: now() } : c));
  return stampChanges(cur, { cats: [...cats, ...extra] });
}

// ── 카테고리 비우기 ──────────────────────────────────
// 배열에서 빼지 않고 살아 있는 항목에 deletedAt만 찍는다 → 동기화로 다른 기기에도 삭제가 전파된다.
// 카테고리 자체(이름·순서)는 그대로. 결과는 setData(stampChanges)를 거쳐 updatedAt을 받는다.
export function clearCategory(c: Category, what: 'all' | 'strokes', t = tick()): Category {
  const kill = <T extends Stamp>(xs: T[]) => xs.map(x => (alive(x) ? { ...x, deletedAt: t } : x));
  return what === 'all' ? { ...c, boxes: kill(c.boxes), links: kill(c.links), strokes: kill(c.strokes) } : { ...c, strokes: kill(c.strokes) };
}

// ── 오래된 툼스톤 정리 ───────────────────────────────
export function purgeTombstones(d: Data, now = Date.now()): Data {
  const keep = <T extends Stamp>(x: T) => x.deletedAt == null || now - x.deletedAt < TOMBSTONE_TTL;
  return {
    cats: d.cats.filter(keep).map(c => ({
      ...c, boxes: c.boxes.filter(keep), links: c.links.filter(keep), strokes: c.strokes.filter(keep),
    })),
  };
}

// ── 외부(이전 버전·백업) 데이터 정규화 ───────────────
// version 1에는 updatedAt/deletedAt/order가 없고 사진은 src(dataURL)로 들어있다.
// srcToImageId는 dataURL을 이미지 저장소에 넣고 id를 돌려주는 함수.
type Loose = Record<string, unknown>;
export async function normalizeData(raw: { cats: Loose[] }, srcToImageId: (src: string) => Promise<string | null>): Promise<Data> {
  const t = tick();
  const st = (x: Loose) => ({ updatedAt: typeof x.updatedAt === 'number' ? x.updatedAt : t, deletedAt: typeof x.deletedAt === 'number' ? x.deletedAt : null });
  const cats: Category[] = [];
  let i = 0;
  for (const c of raw.cats) {
    i++;
    const boxes: Box[] = [];
    for (const b of (c.boxes as Loose[]) || []) {
      const box: Box = {
        id: String(b.id), type: b.type === 'image' ? 'image' : 'text',
        x: Number(b.x) || 0, y: Number(b.y) || 0, w: Number(b.w) || 220, h: Number(b.h) || 110,
        ...(b.type === 'image' ? {} : { text: String(b.text ?? '') }),
        head: typeof b.head === 'string' ? b.head : null, ...st(b),
      };
      if (box.type === 'image') {
        if (typeof b.imageId === 'string') box.imageId = b.imageId;
        else if (typeof b.src === 'string') { const id = await srcToImageId(b.src); if (id) box.imageId = id; }
      }
      boxes.push(box);
    }
    cats.push({
      id: String(c.id), name: String(c.name ?? 'Untitled'), order: typeof c.order === 'number' ? c.order : i,
      boxes,
      links: ((c.links as Loose[]) || []).map(l => ({ id: String(l.id), a: String(l.a), b: String(l.b), ...st(l) })),
      strokes: ((c.strokes as Loose[]) || []).map(s => ({ id: String(s.id), color: String(s.color), width: Number(s.width) || 3, pts: (s.pts as [number, number][]) || [], ...st(s) })),
      ...st(c),
    });
  }
  return { cats };
}

export function maxStamp(d: Data): number {
  let m = 0;
  const f = (x: Stamp) => { if (x.updatedAt > m) m = x.updatedAt; if (x.deletedAt && x.deletedAt > m) m = x.deletedAt; };
  d.cats.forEach(c => { f(c); c.boxes.forEach(f); c.links.forEach(f); c.strokes.forEach(f); });
  return m;
}

export const referencedImages = (d: Data, onlyAlive = false) => {
  const s = new Set<string>();
  d.cats.forEach(c => { if (onlyAlive && !alive(c)) return; c.boxes.forEach(b => { if (b.imageId && (!onlyAlive || alive(b))) s.add(b.imageId); }); });
  return s;
};
