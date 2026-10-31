import { describe, it, expect } from 'vitest';
import { seed, stampChanges, applyTarget, clearCategory, liveBoxes, liveLinks, liveStrokes, tick, type Data } from '../src/model';
import { mergeData } from '../src/merge';

const withStroke = (): Data => {
  const d = seed();
  const t = tick();
  return { cats: d.cats.map((c, i) => (i === 0 ? { ...c, strokes: [{ id: 's1', color: '#fff', width: 2, pts: [[0, 0], [5, 5]], updatedAt: t, deletedAt: null }] } : c)) };
};
const clear = (d: Data, id: string, what: 'all' | 'strokes') => stampChanges(d, { cats: d.cats.map(c => (c.id === id ? clearCategory(c, what) : c)) });

describe('현재 카테고리 비우기', () => {
  it('전부 지우기: 상자·연결선·펜 획에 deletedAt만 기록, 배열에서는 빼지 않음. 카테고리·다른 카테고리는 그대로', () => {
    const d0 = withStroke(), c0 = d0.cats[0];
    const nBox = c0.boxes.length, nLink = c0.links.length;
    expect(liveBoxes(c0).length).toBeGreaterThan(0);
    const d1 = clear(d0, c0.id, 'all'), c1 = d1.cats[0];
    expect([liveBoxes(c1).length, liveLinks(c1).length, liveStrokes(c1).length]).toEqual([0, 0, 0]);
    expect([c1.boxes.length, c1.links.length, c1.strokes.length]).toEqual([nBox, nLink, 1]);
    expect([c1.id, c1.name, c1.order, c1.deletedAt]).toEqual([c0.id, c0.name, c0.order, null]);
    for (let i = 1; i < d0.cats.length; i++) expect(d1.cats[i]).toBe(d0.cats[i]);
    for (const b of c1.boxes) expect(b.updatedAt).toBeGreaterThan(c0.boxes[0].updatedAt);
  });

  it('펜 획만 지우기: 상자·연결선은 그대로', () => {
    const d0 = withStroke(), c0 = d0.cats[0];
    const c1 = clear(d0, c0.id, 'strokes').cats[0];
    expect(liveStrokes(c1)).toHaveLength(0);
    expect(c1.boxes).toBe(c0.boxes);
    expect(c1.links).toBe(c0.links);
  });

  it('다른 기기에 병합하면 삭제가 전파되고, 실행 취소(applyTarget)는 새 updatedAt으로 복구되어 다시 전파된다', () => {
    const d0 = withStroke(), id = d0.cats[0].id;
    const other: Data = JSON.parse(JSON.stringify(d0));
    const d1 = clear(d0, id, 'all');
    const o1 = mergeData(other, d1.cats);
    expect(liveBoxes(o1.cats.find(c => c.id === id)!)).toHaveLength(0);
    const d2 = applyTarget(d1, d0);   // 실행 취소
    const c2 = d2.cats.find(c => c.id === id)!;
    expect(liveBoxes(c2).length).toBe(d0.cats[0].boxes.length);
    for (const b of c2.boxes) expect(b.updatedAt).toBeGreaterThan(d1.cats[0].boxes.find(x => x.id === b.id)!.updatedAt);
    const o2 = mergeData(o1, d2.cats);
    expect(liveBoxes(o2.cats.find(c => c.id === id)!).length).toBe(d0.cats[0].boxes.length);
    expect(liveStrokes(o2.cats.find(c => c.id === id)!)).toHaveLength(1);
  });
});
