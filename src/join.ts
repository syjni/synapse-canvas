// 로그인·연결 코드로 새로 연결한 직후: 이 기기 데이터와 계정(서버) 데이터를 비교하고 "계정에 추가하기"를 계산한다 (순수 함수)
// - 이 기기 카테고리는 서버의 같은 id → 같은 이름(살아 있는 것) → 없음 순으로 짝을 찾는다
// - 같은 id 카테고리: 기존 병합 규칙(mergeCategory). 서버에 없는 항목은 기존 내용과 겹칠 때만 오른쪽으로 옮긴다
// - 같은 이름 카테고리: 서버 카테고리에 넣는다. 새 상자·연결선·펜 획은 새 id를 받고, 묶어서 기존 내용 오른쪽으로 GAP만큼 띄워 옮긴다
//   같은 id·같은 내용인 항목과 손대지 않은 초기 예시 상자는 이미 있는 것으로 보고 넣지 않는다
//   (예시 상자 id는 기기마다 같아서, 계정 쪽에서 고친 예시 상자 옆에 원래 예시가 하나 더 생기지 않게)
// - 짝이 없는 카테고리: 새 카테고리로 탭 끝에 추가. 단 손대지 않은 예시뿐인 초기 카테고리(Custom 1 등)는 넣지 않는다
import { alive, uid, observeClock, maxStamp, seed, SEED_LANGS, type Box, type Category, type Data, type Link, type Stroke } from './model';
import { mergeCategory, stableStringify } from './merge';

export const JOIN_GAP = 120;

export type Counts = { cats: number; boxes: number; links: number; strokes: number };
export type JoinPlan = {
  ask: boolean;
  mine: Counts & { newer: number };          // 이 기기에만 있는 것 + 이 기기에서 더 최근에 고친 항목 수
  account: { cats: number; boxes: number };  // 계정(서버)의 살아 있는 카테고리·상자 수
};

// 초기 예시(seed) 상자의 내용. 이 내용 그대로인 상자 = 손대지 않은 예시 (기기마다 처음 언어가 다를 수 있어 모든 언어의 예시)
const boxKey = (b: Box) => stableStringify([b.type, b.x, b.y, b.w, b.h, b.text ?? null, b.imageId ?? null, b.head ?? null]);
const SEED_BOX = new Map<string, Set<string>>(), SEED_NAMES = new Set<string>();
for (const l of SEED_LANGS) for (const c of seed(l).cats) {
  SEED_NAMES.add(c.name);
  for (const b of c.boxes) { if (!SEED_BOX.has(b.id)) SEED_BOX.set(b.id, new Set()); SEED_BOX.get(b.id)!.add(boxKey(b)); }
}
const isExample = (b: Box) => !!SEED_BOX.get(b.id)?.has(boxKey(b));

type Pair = { kind: 'same' | 'name'; cat: Category } | { kind: 'new' };
const sameContent = (a: object, b: object) => stableStringify({ ...a, updatedAt: 0, deletedAt: 0 }) === stableStringify({ ...b, updatedAt: 0, deletedAt: 0 });

function pairOf(local: Category, server: Category[]): Pair {
  const byId = server.find(c => c.id === local.id);
  if (byId) return { kind: 'same', cat: byId };
  const byName = server.find(c => alive(c) && c.name.trim() === local.name.trim());
  return byName ? { kind: 'name', cat: byName } : { kind: 'new' };
}

// 이 기기 카테고리에서 서버 짝에 없는 (살아 있는) 항목
function fresh<T extends { id: string; updatedAt: number; deletedAt: number | null }>(mine: T[], theirs: T[], dedupe: boolean): T[] {
  const m = new Map(theirs.map(x => [x.id, x]));
  return mine.filter(x => {
    if (!alive(x)) return false;
    const t = m.get(x.id);
    if (!t) return true;
    return dedupe && !sameContent(x, t);   // 같은 이름 카테고리: id가 같아도 내용이 다르면 다른 항목
  });
}
// 같은 id 항목 중 이 기기 쪽이 더 최근인 수
function newerCount<T extends { id: string; updatedAt: number }>(mine: T[], theirs: T[]) {
  const m = new Map(theirs.map(x => [x.id, x]));
  return mine.filter(x => { const t = m.get(x.id); return !!t && x.updatedAt > t.updatedAt; }).length;
}

// "이 기기에만 있는 것"은 실제로 더할 것과 같게 addToAccount로 센다
export function planJoin(local: Data, server: Category[]): JoinPlan {
  const live = server.filter(alive);
  const account = { cats: live.length, boxes: live.reduce((n, c) => n + c.boxes.filter(alive).length, 0) };
  let newer = 0;
  for (const c of local.cats) {
    const p = pairOf(c, server);
    if (p.kind !== 'same') continue;
    const s = p.cat;
    newer += (c.updatedAt > s.updatedAt ? 1 : 0) + newerCount(c.boxes, s.boxes) + newerCount(c.links, s.links) + newerCount(c.strokes, s.strokes);
  }
  const mine = { ...addToAccount(local, server).added, newer };
  // 계정이 비어 있으면 고를 것이 없다 → 묻지 않고 그대로 올린다
  const ask = live.length > 0 && mine.cats + mine.boxes + mine.links + mine.strokes + mine.newer > 0;
  return { ask, mine, account };
}

// ── 배치 ─────────────────────────────────────────────
type Rect = { x0: number; y0: number; x1: number; y1: number } | null;
function bounds(boxes: Box[], strokes: Stroke[]): Rect {
  let r: Rect = null;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    r = r ? { x0: Math.min(r.x0, x0), y0: Math.min(r.y0, y0), x1: Math.max(r.x1, x1), y1: Math.max(r.y1, y1) } : { x0, y0, x1, y1 };
  };
  for (const b of boxes) if (alive(b)) add(b.x, b.y, b.x + b.w, b.y + b.h);
  for (const s of strokes) if (alive(s)) for (const [x, y] of s.pts) add(x, y, x, y);
  return r;
}
const overlaps = (a: Rect, b: Rect) => !!a && !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function shift(boxes: Box[], strokes: Stroke[], dx: number) {
  return {
    boxes: boxes.map(b => ({ ...b, x: b.x + dx })),
    strokes: strokes.map(s => ({ ...s, pts: s.pts.map(([x, y]) => [x + dx, y] as [number, number]) })),
  };
}

export type JoinResult = {
  data: Data;                       // 추가한 결과
  base: Data;                       // 새 항목을 넣기 전 (실행 취소 목표)
  added: Counts;
  touched: string[];                // 새 항목이 들어간 카테고리 id (전체 보기로 맞출 것)
  catMap: Record<string, string>;   // 이 기기 카테고리 id → 결과 카테고리 id
};

// local(이 기기 또는 백업)을 account(서버 또는 현재 데이터)에 더한다. account의 내용은 덮어쓰지 않는다(같은 id는 updatedAt 큰 쪽).
export function addToAccount(local: Data, account: Category[]): JoinResult {
  observeClock(maxStamp({ cats: account }));   // mergeData와 같이: 다음 수정이 받은 것보다 확실히 최신이 되도록
  const out = new Map(account.map(c => [c.id, c]));
  const base = new Map(out);
  const added: Counts = { cats: 0, boxes: 0, links: 0, strokes: 0 };
  const touched = new Set<string>();
  const catMap: Record<string, string> = {};
  let order = Math.max(0, ...account.filter(alive).map(c => c.order));

  for (const c of local.cats) {
    const p = pairOf(c, account);
    if (p.kind === 'new') {
      if (!alive(c)) continue;
      const own = c.boxes.some(b => alive(b) && !isExample(b)) || c.strokes.some(alive);
      if (!own && SEED_NAMES.has(c.name.trim())) continue;
      const nc: Category = { ...c, order: ++order, boxes: c.boxes.filter(alive), links: c.links.filter(alive), strokes: c.strokes.filter(alive) };
      out.set(c.id, nc); catMap[c.id] = c.id; touched.add(c.id);
      added.cats++; added.boxes += nc.boxes.length; added.links += nc.links.length; added.strokes += nc.strokes.length;
      continue;
    }
    if (p.kind === 'name' && !alive(c)) continue;
    const cur = out.get(p.cat.id)!;   // 앞선 같은 이름 카테고리가 이미 더했을 수 있으므로 지금까지의 결과에서
    catMap[c.id] = cur.id;

    let nb: Box[], nl: Link[], ns: Stroke[], target: Category;
    if (p.kind === 'same') {
      // 서버에 있는 항목끼리만 먼저 병합 → 실행 취소 목표. 그다음 서버에 없는 항목을 더한다
      const known = <T extends { id: string }>(xs: T[], ys: T[]) => { const ids = new Set(ys.map(y => y.id)); return xs.filter(x => ids.has(x.id)); };
      target = mergeCategory({ ...c, boxes: known(c.boxes, cur.boxes), links: known(c.links, cur.links), strokes: known(c.strokes, cur.strokes) }, cur);
      base.set(cur.id, target);
      nb = fresh(c.boxes, cur.boxes, false); nl = fresh(c.links, cur.links, false); ns = fresh(c.strokes, cur.strokes, false);
    } else {
      target = cur;
      nb = fresh(c.boxes, cur.boxes, true).filter(b => !isExample(b)); ns = fresh(c.strokes, cur.strokes, true);
      // 새 id를 주고 연결선 끝을 다시 잇는다. 넣지 않은(이미 있는) 상자로 가는 끝은 그 상자 id 그대로
      const ids = new Map(nb.map(b => [b.id, uid()]));
      const have = new Set(cur.boxes.filter(alive).map(b => b.id));
      nb = nb.map(b => ({ ...b, id: ids.get(b.id)! }));
      ns = ns.map(s => ({ ...s, id: uid() }));
      // 이미 같은 두 상자를 잇는 연결선이 있으면 넣지 않는다 (초기 예시의 연결선은 기기마다 id가 달라서)
      const pairs = new Set(cur.links.filter(alive).flatMap(l => [l.a + '>' + l.b, l.b + '>' + l.a]));
      nl = fresh(c.links, cur.links, true).flatMap(l => {
        const a = ids.get(l.a) ?? (have.has(l.a) ? l.a : null), b = ids.get(l.b) ?? (have.has(l.b) ? l.b : null);
        if (!a || !b || pairs.has(a + '>' + b)) return [];
        pairs.add(a + '>' + b); pairs.add(b + '>' + a);
        return [{ ...l, id: uid(), a, b }];
      });
    }
    if (!nb.length && !nl.length && !ns.length) { out.set(cur.id, target); continue; }

    const have = bounds(target.boxes, target.strokes), group = bounds(nb, ns);
    if (have && group && (p.kind === 'name' || overlaps(have, group))) ({ boxes: nb, strokes: ns } = shift(nb, ns, have.x1 + JOIN_GAP - group.x0));
    out.set(cur.id, { ...target, boxes: [...target.boxes, ...nb], links: [...target.links, ...nl], strokes: [...target.strokes, ...ns] });
    touched.add(cur.id);
    added.boxes += nb.length; added.links += nl.length; added.strokes += ns.length;
  }
  return { data: { cats: [...out.values()] }, base: { cats: [...base.values()] }, added, touched: [...touched], catMap };
}
