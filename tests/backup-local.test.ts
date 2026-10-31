import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { saveLocalBackup, listLocalBackups, getLocalBackup, restoreBackupImages, putImage, getImage, deleteImage, expiredBackups, BACKUP_TTL } from '../src/storage';
import { addToAccount } from '../src/join';
import { seed, tick, alive, type Category, type Data } from '../src/model';

const DAY = 24 * 3600 * 1000;
const withPhoto = (): Data => {
  const d = seed();
  const mine: Category = {
    id: 'trip', name: 'Trip', order: 9, updatedAt: tick(), deletedAt: null, links: [], strokes: [],
    boxes: [
      { id: 't1', type: 'text', x: 0, y: 0, w: 200, h: 80, text: '여행 계획', updatedAt: tick(), deletedAt: null },
      { id: 't2', type: 'image', x: 0, y: 120, w: 200, h: 150, imageId: 'img-trip', updatedAt: tick(), deletedAt: null },
    ],
  };
  return { cats: [...d.cats, mine] };
};

describe('계정 내용만 불러오기 전 기기 백업', () => {
  it('백업에 데이터와 사진이 들어가고, 복구하면 사진을 되돌리고 계정 내용에 추가된다', async () => {
    await putImage('img-trip', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
    const mine = withPhoto();
    const b = await saveLocalBackup(mine);
    // 계정 내용으로 바꾼 뒤 시작 시 정리로 사진이 지워진 상황
    await deleteImage('img-trip');
    const list = await listLocalBackups();
    expect(list.map(x => x.id)).toContain(b.id);
    const got = (await getLocalBackup(b.id))!;
    expect(Object.keys(got.images)).toEqual(['img-trip']);
    await restoreBackupImages(got);
    expect((await getImage('img-trip'))!.size).toBe(3);
    // 현재(계정) 데이터에 추가: 예시는 더하지 않고 Trip 카테고리만 새로
    const account = seed();
    const r = addToAccount(got.data, account.cats);
    expect(r.added).toEqual({ cats: 1, boxes: 2, links: 0, strokes: 0 });
    expect(r.data.cats.filter(alive).map(c => c.name)).toContain('Trip');
    expect(r.data.cats.find(c => c.id === 'trip')!.boxes.find(x => x.id === 't2')!.imageId).toBe('img-trip');
  });

  it('최근 3개까지만 남기고 30일 지난 백업은 지운다', async () => {
    const now = Date.now();
    for (let i = 0; i < 4; i++) await saveLocalBackup(seed(), now + i);
    const list = await listLocalBackups(now + 10);
    expect(list).toHaveLength(3);
    expect(list.map(x => x.at)).toEqual([now + 3, now + 2, now + 1]);
    expect(await listLocalBackups(now + 1 + BACKUP_TTL + 1)).toHaveLength(2);
    expect(await listLocalBackups(now + 3 + BACKUP_TTL + 1)).toHaveLength(0);
  });

  it('지울 백업 고르기', () => {
    const now = 100 * DAY;
    const l = [{ id: 'a', at: now - 31 * DAY }, { id: 'b', at: now - DAY }, { id: 'c', at: now - 2 * DAY }, { id: 'd', at: now - 3 * DAY }, { id: 'e', at: now - 4 * DAY }];
    expect(expiredBackups(l, now).sort()).toEqual(['a', 'e']);
  });
});
