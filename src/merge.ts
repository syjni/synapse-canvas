// 기기 간 병합 규칙 (순수 함수 — 동기화 엔진과 화면 양쪽에서 쓴다)
// - 카테고리는 id로 맞추고, 안의 Box·Link·Stroke도 id 기준으로 병합
// - 같은 항목이 양쪽에 있으면 updatedAt이 큰 쪽을 통째로 채택 (필드 단위 병합·충돌 사본 없음)
// - 삭제(deletedAt)도 updatedAt을 함께 올리므로 "더 최근 쪽"이 그대로 이긴다
//   (삭제가 더 늦으면 삭제, 삭제 뒤에 다른 기기에서 더 늦게 수정했으면 수정)
// - updatedAt이 같으면 내용 문자열을 비교해 어느 기기에서 병합해도 같은 결과가 나오게 한다
// - 항목 순서는 서버(remote) 순서 + 로컬에만 있는 항목 순 → 기기들이 같은 순서로 수렴
import type { Category, Data, Prefs, PrefsT, Stamp } from './model';
import { PREF_KEYS, observeClock, maxStamp, seed } from './model';

// 키 순서와 상관없이 같은 문자열 (jsonb 왕복 후에도 비교 가능)
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

function pick<T extends Stamp>(a: T | undefined, b: T | undefined): T {
  if (!a) return b!;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  return stableStringify(a) >= stableStringify(b) ? a : b;
}

function mergeList<T extends Stamp & { id: string }>(local: T[], remote: T[]): T[] {
  const lm = new Map(local.map(x => [x.id, x]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of remote) { seen.add(r.id); out.push(pick(lm.get(r.id), r)); }
  for (const l of local) if (!seen.has(l.id)) out.push(l);
  return out;
}

const selfPart = (c: Category) => ({ id: c.id, name: c.name, order: c.order, updatedAt: c.updatedAt, deletedAt: c.deletedAt });

export function mergeCategory(local: Category | undefined, remote: Category): Category {
  if (!local) return remote;
  const self = pick(selfPart(local), selfPart(remote));
  return {
    ...self,
    boxes: mergeList(local.boxes, remote.boxes),
    links: mergeList(local.links, remote.links),
    strokes: mergeList(local.strokes, remote.strokes),
  };
}

export function mergeData(local: Data, remoteCats: Category[]): Data {
  // 다른 기기의 시각을 보면 이 기기 시계도 그 뒤로 맞춘다 (다음 수정이 확실히 더 최신이 되도록)
  observeClock(maxStamp({ cats: remoteCats }));
  const lm = new Map(local.cats.map(c => [c.id, c]));
  const rIds = new Set(remoteCats.map(c => c.id));
  const merged = remoteCats.map(r => mergeCategory(lm.get(r.id), r));
  return { cats: [...merged, ...local.cats.filter(c => !rIds.has(c.id))] };
}

// 실행 취소 히스토리 보정: 원격 병합으로 실제로 바뀐 항목만(before→after에서 참조가 바뀐 것) 과거 스냅샷에도 반영한다.
// 그래야 실행 취소가 다른 기기의 변경을 되돌리거나 지우지 않는다.
export function rebaseSnapshot(snap: Data, before: Data, after: Data): Data {
  const bm = new Map(before.cats.map(c => [c.id, c]));
  const sm = new Map(snap.cats.map(c => [c.id, c]));
  const out = new Map(sm);
  for (const a of after.cats) {
    const b = bm.get(a.id);
    if (b === a) continue;
    const s = sm.get(a.id);
    if (!b || !s) { if (!b) out.set(a.id, a); continue; }
    const fix = <T extends { id: string }>(sl: T[], bl: T[], al: T[]) => {
      const bmap = new Map(bl.map(x => [x.id, x]));
      const changed = al.filter(x => bmap.get(x.id) !== x);
      if (!changed.length) return sl;
      const cm = new Map(changed.map(x => [x.id, x]));
      const res = sl.map(x => cm.get(x.id) ?? x);
      const have = new Set(sl.map(x => x.id));
      for (const x of changed) if (!have.has(x.id)) res.push(x);
      return res;
    };
    const selfChanged = a.name !== b.name || a.order !== b.order || a.deletedAt !== b.deletedAt || a.updatedAt !== b.updatedAt;
    out.set(a.id, {
      ...(selfChanged ? { ...s, name: a.name, order: a.order, deletedAt: a.deletedAt, updatedAt: a.updatedAt } : s),
      boxes: fix(s.boxes, b.boxes, a.boxes), links: fix(s.links, b.links, a.links), strokes: fix(s.strokes, b.strokes, a.strokes),
    });
  }
  return { cats: [...out.values()] };
}

export type PrefsBundle = { prefs: Prefs; prefsT: PrefsT };
// 설정은 항목별 updatedAt 비교
export function mergePrefs(local: PrefsBundle, remote: PrefsBundle): PrefsBundle {
  const prefs = { ...local.prefs } as Record<string, unknown>;
  const prefsT = { ...local.prefsT };
  for (const k of PREF_KEYS) {
    const rt = remote.prefsT?.[k] ?? 0, lt = local.prefsT[k] ?? 0;
    const rv = (remote.prefs as Record<string, unknown>)?.[k];
    if (rv === undefined) continue;
    if (rt > lt || (rt === lt && stableStringify(rv) > stableStringify(prefs[k]))) { prefs[k] = rv; prefsT[k] = rt; }
    observeClock(rt);
  }
  return { prefs: prefs as Prefs, prefsT };
}

// 처음 실행 후 아무것도 고치지 않은 초기 데이터인지 (새 기기를 보관함에 연결할 때 초기 예시가 중복되지 않게)
// 시각이 모두 같고(한 번도 수정 안 함) 내용도 seed()와 같아야 한다 — 이전 버전에서 옮겨온 데이터도 시각이 모두 같으므로 내용까지 비교
export function isPristineSeed(d: Data): boolean {
  const stamps = new Set<number>();
  for (const c of d.cats) {
    if (c.deletedAt != null) return false;
    stamps.add(c.updatedAt);
    for (const x of [...c.boxes, ...c.links, ...c.strokes]) { if (x.deletedAt != null) return false; stamps.add(x.updatedAt); }
  }
  if (stamps.size !== 1) return false;
  const shape = (x: Data) => stableStringify(x.cats.map(c => ({
    name: c.name, order: c.order, strokes: c.strokes.length,
    boxes: c.boxes.map(b => ({ id: b.id, type: b.type, x: b.x, y: b.y, w: b.w, h: b.h, text: b.text ?? null, image: b.imageId ?? null, head: b.head ?? null })),
    links: c.links.map(l => [l.a, l.b]),
  })));
  return shape(d) === shape(seed());
}
