import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { makeDb, addUser, one, rows, as, PgRemote, PgImages, memLocalImages } from './pg';
import { SyncEngine, type Host, type Meta, type MetaStore, type SyncStatus } from '../src/sync';
import { mergeData, mergePrefs, mergeCategory, rebaseSnapshot, isPristineSeed, type PrefsBundle } from '../src/merge';
import { type Data, type Category, type Box, seed, stampChanges, tick, DEF_PREFS, zeroPrefsT, liveLinks, alive } from '../src/model';

// ── 기기 대역 ────────────────────────────────────────────────────────
class Device {
  data: Data; pb: PrefsBundle = { prefs: { ...DEF_PREFS }, prefsT: zeroPrefsT() };
  remote: PgRemote; engine!: SyncEngine; status: SyncStatus = 'off'; revoked = false;
  local = memLocalImages(); metaBox: { m: Meta | null } = { m: null };
  constructor(public db: PGlite, public uid: string, data: Data) {
    this.data = data;
    this.remote = new PgRemote(db, uid);
  }
  connect(vaultId: string, firstSync = true) {
    const store: MetaStore = { load: () => this.metaBox.m, save: m => { this.metaBox.m = JSON.parse(JSON.stringify(m)); }, clear: () => { this.metaBox.m = null; } };
    const host: Host = {
      getData: () => this.data,
      getPrefs: () => this.pb,
      applyRemote: async (cats, p, replace) => {
        this.data = replace ? { cats } : mergeData(this.data, cats);
        if (p) this.pb = mergePrefs(this.pb, p);
      },
    };
    this.engine = new SyncEngine({
      remote: this.remote, images: new PgImages(this.db, this.uid, this.remote), local: this.local, metaStore: store, host,
      meta: { vaultId, deviceName: 'dev', firstSync, versions: {}, synced: {}, prefsVersion: 0, prefsHash: '', uploaded: {} },
      onStatus: s => { this.status = s; }, onRevoked: () => { this.revoked = true; }, retryDelay: 1e9,
    });
    return this;
  }
  edit(fn: (d: Data) => Data) { this.data = stampChanges(this.data, fn(this.data)); }
  cat(name: string) { return this.data.cats.find(c => c.name === name && alive(c))!; }
  box(catName: string, id: string) { return this.cat(catName).boxes.find(b => b.id === id); }
  setText(catName: string, id: string, text: string) {
    const cid = this.cat(catName).id;
    this.edit(d => ({ cats: d.cats.map(c => (c.id === cid ? { ...c, boxes: c.boxes.map(b => (b.id === id ? { ...b, text } : b)) } : c)) }));
  }
  addBox(catName: string, box: Partial<Box> & { id: string }) {
    const cid = this.cat(catName).id;
    this.edit(d => ({ cats: d.cats.map(c => (c.id === cid ? { ...c, boxes: [...c.boxes, { type: 'text', x: 0, y: 0, w: 220, h: 110, text: '', head: null, updatedAt: 0, deletedAt: null, ...box } as Box] } : c)) }));
  }
  delBox(catName: string, id: string) {
    const cid = this.cat(catName).id, t = tick();
    this.edit(d => ({ cats: d.cats.map(c => (c.id === cid ? { ...c, boxes: c.boxes.map(b => (b.id === id ? { ...b, deletedAt: t } : b)) } : c)) }));
  }
  sync() { return this.engine.syncNow(); }
}

// 아이디 열쇠로 보관함 생성 + 첫 기기 연결 (앱의 enable 흐름과 같은 SQL 순서)
async function makeVault(db: PGlite, login: string) {
  const idUser = await addUser(db, { login });
  const vault = (await one<{ v: string }>(db, idUser, `select public.create_vault('ID ${login}') as v`))!.v;
  return { idUser, vault };
}
async function pairCode(db: PGlite, uid: string) { return (await one<{ c: { code: string } }>(db, uid, 'select public.create_pairing() as c'))!.c.code; }
async function claim(db: PGlite, uid: string, code: string, name = 'dev') { return (await one<{ r: { ok: boolean; error?: string; vault_id?: string } }>(db, uid, 'select public.claim_pairing($1, $2) as r', [code, name]))!.r; }
async function newDevice(db: PGlite, from: string, name: string, data: Data = seed()) {
  const uid = await addUser(db, { anonymous: true });
  const r = await claim(db, uid, await pairCode(db, from), name);
  expect(r.ok).toBe(true);
  return { uid, dev: new Device(db, uid, data) };
}

const custom = (): Data => { const d = seed(); return { cats: d.cats.map(c => ({ ...c })) }; };

// ═════════════════════════════════════════════════════════════════════
describe('병합 규칙', () => {
  const base = (): Category => ({ id: 'c', name: 'Mind', order: 1, updatedAt: 1, deletedAt: null, links: [], strokes: [], boxes: [] });
  const bx = (id: string, text: string, t: number, del: number | null = null): Box => ({ id, type: 'text', x: 0, y: 0, w: 1, h: 1, text, updatedAt: t, deletedAt: del });

  it('서로 다른 항목은 둘 다 남는다', () => {
    const m = mergeCategory({ ...base(), boxes: [bx('a', 'A', 5)] }, { ...base(), boxes: [bx('b', 'B', 6)] });
    expect(m.boxes.map(b => b.id).sort()).toEqual(['a', 'b']);
  });
  it('같은 항목은 updatedAt이 큰 쪽을 통째로', () => {
    const m = mergeCategory({ ...base(), boxes: [bx('a', 'local', 10)] }, { ...base(), boxes: [bx('a', 'remote', 9)] });
    expect(m.boxes[0].text).toBe('local');
  });
  it('삭제가 더 최근이면 삭제, 삭제 뒤 더 늦은 수정이면 수정', () => {
    expect(mergeCategory({ ...base(), boxes: [bx('a', 'edit', 10)] }, { ...base(), boxes: [bx('a', 'x', 11, 11)] }).boxes[0].deletedAt).toBe(11);
    expect(mergeCategory({ ...base(), boxes: [bx('a', 'edit', 12)] }, { ...base(), boxes: [bx('a', 'x', 11, 11)] }).boxes[0].deletedAt).toBe(null);
  });
  it('어느 쪽에서 병합해도 결과가 같다 (순서·동점 포함)', () => {
    const L = { ...base(), boxes: [bx('a', 'p', 5), bx('b', 'q', 7)] }, R = { ...base(), boxes: [bx('b', 'r', 7), bx('a', 's', 6)] };
    const m1 = mergeData({ cats: [L] }, [R]), m2 = mergeData({ cats: [R] }, [L]);
    expect(m1.cats[0].boxes.map(b => b.text).sort()).toEqual(m2.cats[0].boxes.map(b => b.text).sort());
  });
  it('양 끝 상자 중 하나가 삭제되면 연결선은 숨김', () => {
    const c: Category = { ...base(), boxes: [bx('a', '', 1), bx('b', '', 1, 2)], links: [{ id: 'l', a: 'a', b: 'b', updatedAt: 1, deletedAt: null }] };
    expect(liveLinks(c)).toHaveLength(0);
  });
  it('설정은 항목별 updatedAt', () => {
    const l = { prefs: { ...DEF_PREFS, grain: 10, pulse: false }, prefsT: { ...zeroPrefsT(), grain: 5, pulse: 9 } };
    const r = { prefs: { ...DEF_PREFS, grain: 30, pulse: true }, prefsT: { ...zeroPrefsT(), grain: 8, pulse: 3 } };
    const m = mergePrefs(l, r);
    expect([m.prefs.grain, m.prefs.pulse]).toEqual([30, false]);
  });
  it('실행 취소 히스토리 보정: 원격에서 들어온 항목만 과거 스냅샷에 반영', () => {
    const snap: Data = { cats: [{ ...base(), boxes: [bx('mine', 'old', 1)] }] };
    const before: Data = { cats: [{ ...base(), boxes: [bx('mine', 'new', 2)] }] };
    const after = mergeData(before, [{ ...base(), boxes: [bx('theirs', 'T', 3)] }]);
    const r = rebaseSnapshot(snap, before, after);
    expect(r.cats[0].boxes.find(b => b.id === 'mine')!.text).toBe('old');   // 내 수정은 되돌릴 수 있게 그대로
    expect(r.cats[0].boxes.find(b => b.id === 'theirs')).toBeTruthy();       // 다른 기기의 상자는 실행 취소로 지워지지 않게
  });
  it('초기 예시 데이터 판별 (이전 버전에서 옮긴 데이터는 아님)', () => {
    expect(isPristineSeed(seed())).toBe(true);
    const d = seed(); d.cats[0] = { ...d.cats[0], boxes: d.cats[0].boxes.map(b => (b.id === 'm1' ? { ...b, text: '바꿈' } : b)) };
    expect(isPristineSeed(d)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('RLS·보안 (schema.sql)', () => {
  let db: PGlite; let A: { idUser: string; vault: string }; let B: { idUser: string; vault: string };
  beforeAll(async () => {
    db = await makeDb();
    A = await makeVault(db, 'alice'); B = await makeVault(db, 'bobby');
    await one(db, A.idUser, `select public.put_category($1, 'cA', '{"x":1}'::jsonb, 0)`, [A.vault]);
    await one(db, A.idUser, `select public.put_prefs($1, '{"p":1}'::jsonb, 0)`, [A.vault]);
    await one(db, A.idUser, `insert into storage.objects (bucket_id, name) values ('images', $1)`, [`${A.vault}/img1.jpg`]);
  });

  it('다른 보관함의 카테고리·설정·멤버·보관함은 0행', async () => {
    expect(await rows(db, B.idUser, 'select * from public.categories where vault_id = $1', [A.vault])).toHaveLength(0);
    expect(await rows(db, B.idUser, 'select * from public.prefs where vault_id = $1', [A.vault])).toHaveLength(0);
    expect(await rows(db, B.idUser, 'select * from public.vault_members where vault_id = $1', [A.vault])).toHaveLength(0);
    expect(await rows(db, B.idUser, 'select * from public.vaults where id = $1', [A.vault])).toHaveLength(0);
    expect(await rows(db, A.idUser, 'select * from public.categories')).toHaveLength(1);
  });
  it('다른 보관함에 쓰기 불가 (함수 거부)', async () => {
    await expect(one(db, B.idUser, `select public.put_category($1, 'evil', '{}'::jsonb, 0)`, [A.vault])).rejects.toThrow(/not_member/);
    await expect(one(db, B.idUser, `select public.put_prefs($1, '{}'::jsonb, 1)`, [A.vault])).rejects.toThrow(/not_member/);
  });
  it('테이블 직접 쓰기 불가 (자기 보관함이어도)', async () => {
    await expect(one(db, A.idUser, `insert into public.categories (vault_id, id, data) values ($1, 'x', '{}')`, [A.vault])).rejects.toThrow(/permission denied/);
    await expect(one(db, A.idUser, `update public.categories set data = '{}' where vault_id = $1`, [A.vault])).rejects.toThrow(/permission denied/);
    await expect(one(db, A.idUser, `insert into public.vault_members (vault_id, user_id, kind) values ($1, $2, 'device')`, [B.vault, A.idUser])).rejects.toThrow(/permission denied/);
    await expect(one(db, A.idUser, 'select * from public.pairing_codes')).rejects.toThrow(/permission denied/);
  });
  it('Storage: 다른 보관함 폴더 읽기·쓰기 불가', async () => {
    expect(await rows(db, B.idUser, `select * from storage.objects where name like $1`, [`${A.vault}/%`])).toHaveLength(0);
    await expect(one(db, B.idUser, `insert into storage.objects (bucket_id, name) values ('images', $1)`, [`${A.vault}/evil.jpg`])).rejects.toThrow(/row-level security/);
    expect(await rows(db, A.idUser, `select * from storage.objects where name like $1`, [`${A.vault}/%`])).toHaveLength(1);
  });
  it('로그인 안 한 요청(anon)은 아무것도 못 읽음', async () => {
    await expect(db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query('select * from public.categories')).rows; })).rejects.toThrow(/permission denied/);
  });
  it('내부 함수(_drop_user 등)는 직접 호출 불가', async () => {
    await expect(one(db, B.idUser, 'select public._drop_user($1)', [A.idUser])).rejects.toThrow(/permission denied/);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('기기 연결 코드', () => {
  let db: PGlite; let V: { idUser: string; vault: string };
  beforeAll(async () => { db = await makeDb(); V = await makeVault(db, 'pairer'); });

  it('코드는 한 번만 쓸 수 있다', async () => {
    const code = await pairCode(db, V.idUser);
    expect(code).toMatch(/^\d{6}$/);
    const d1 = await addUser(db, { anonymous: true }), d2 = await addUser(db, { anonymous: true });
    expect((await claim(db, d1, code)).ok).toBe(true);
    expect(await claim(db, d2, code)).toMatchObject({ ok: false, error: 'invalid_code' });
    const m = await one<{ kind: string }>(db, d1, 'select kind from public.vault_members where user_id = $1', [d1]);
    expect(m!.kind).toBe('device');
  });
  it('만료된 코드는 무효', async () => {
    const code = await pairCode(db, V.idUser);
    await db.query(`update public.pairing_codes set expires_at = now() - interval '1 second' where code = $1`, [code]);
    expect(await claim(db, await addUser(db, { anonymous: true }), code)).toMatchObject({ ok: false, error: 'invalid_code' });
  });
  it('틀린 입력 5회면 그 코드 무효 + 열쇠당 시도 제한', async () => {
    const code = await pairCode(db, V.idUser);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await claim(db, await addUser(db, { anonymous: true }), wrong);
    expect(await claim(db, await addUser(db, { anonymous: true }), code)).toMatchObject({ ok: false, error: 'invalid_code' });
    const greedy = await addUser(db, { anonymous: true });
    for (let i = 0; i < 5; i++) await claim(db, greedy, wrong);
    const fresh = await pairCode(db, V.idUser);
    expect(await claim(db, greedy, fresh)).toMatchObject({ ok: false, error: 'too_many_attempts' });
  });
  it('아이디 열쇠(비익명)로 수령하면 password 종류로 등록 — 열쇠 재발급 흐름', async () => {
    const code = await pairCode(db, V.idUser);
    const newId = await addUser(db, { login: 'pairer2' });
    expect((await claim(db, newId, code)).ok).toBe(true);
    const m = await one<{ kind: string; login_id: string }>(db, newId, 'select kind, login_id from public.vault_members where user_id = $1', [newId]);
    expect(m).toMatchObject({ kind: 'password', login_id: 'pairer2' });
    await one(db, newId, 'select public.remove_member($1)', [V.idUser]);   // 이전 아이디 열쇠 제거
    expect(await rows(db, V.idUser, 'select * from public.categories')).toHaveLength(0);
    expect(await one(db, V.idUser, 'select public.my_vault_id() as v')).toMatchObject({ v: null });
    expect((await db.query('select 1 from auth.users where id = $1', [V.idUser])).rows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('두 기기 동기화 (SyncEngine + schema.sql)', () => {
  let db: PGlite; let V: { idUser: string; vault: string }; let A: Device; let B: Device;

  beforeAll(async () => {
    db = await makeDb();
    V = await makeVault(db, 'owner');
    // A: 동기화 켜기 → 자기 데이터 업로드
    const a = await newDevice(db, V.idUser, 'A', custom());
    A = a.dev.connect(V.vault, false);
    A.setText('Mind', 'm1', 'A의 첫 데이터');
    await A.sync();
    // B: 아이디 로그인 경로(아이디 열쇠가 코드 발급) — 초기 예시 데이터는 보관함 내용으로 교체
    const b = await newDevice(db, V.idUser, 'B');
    B = b.dev.connect(V.vault, true);
    await B.sync();
  });

  it('새 기기의 초기 예시 데이터는 교체되고 중복 카테고리가 생기지 않는다', () => {
    expect(B.data.cats.filter(c => c.name === 'Mind')).toHaveLength(1);
    expect(B.box('Mind', 'm1')!.text).toBe('A의 첫 데이터');
    expect([A.status, B.status]).toEqual(['SYNCED', 'SYNCED']);
  });

  it('서로 다른 상자를 양쪽에서 수정 → 둘 다 반영', async () => {
    A.setText('Mind', 'm2', 'A가 m2 수정');
    B.setText('Mind', 'm3', 'B가 m3 수정');
    await A.sync(); await B.sync(); await A.sync();
    for (const d of [A, B]) {
      expect(d.box('Mind', 'm2')!.text).toBe('A가 m2 수정');
      expect(d.box('Mind', 'm3')!.text).toBe('B가 m3 수정');
    }
  });

  it('같은 상자를 양쪽에서 수정 → 나중 것만 남음 (조건부 저장 충돌 후 재시도 포함)', async () => {
    A.setText('Ideas', 'i1', 'A 먼저');
    await new Promise(r => setTimeout(r, 5));
    B.setText('Ideas', 'i1', 'B 나중');
    await B.sync();                 // B 먼저 올림
    // A는 pull 없이 바로 올리기 → version 충돌(-1) → 다시 받아 병합 → B가 더 최신이라 B 유지
    const c0 = A.remote.conflicts;
    await (A.engine as unknown as { push(): Promise<void> }).push();
    expect(A.remote.conflicts).toBeGreaterThan(c0);
    await A.sync();
    await B.sync();
    expect(A.box('Ideas', 'i1')!.text).toBe('B 나중');
    expect(B.box('Ideas', 'i1')!.text).toBe('B 나중');
  });

  it('한쪽에서 삭제, 다른 쪽은 그보다 먼저 수정 → 삭제 유지', async () => {
    A.setText('Mind', 'm4', 'A가 먼저 수정(아직 안 올림)');
    await new Promise(r => setTimeout(r, 5));
    B.delBox('Mind', 'm4');
    await B.sync(); await A.sync(); await B.sync();
    expect(A.box('Mind', 'm4')!.deletedAt).not.toBeNull();
    expect(B.box('Mind', 'm4')!.deletedAt).not.toBeNull();
  });

  it('삭제 뒤 다른 기기에서 더 늦게 수정 → 수정이 이김', async () => {
    B.delBox('Ideas', 'i2');
    await new Promise(r => setTimeout(r, 5));
    A.setText('Ideas', 'i2', 'A가 나중에 수정');
    await B.sync(); await A.sync(); await B.sync();
    for (const d of [A, B]) { expect(d.box('Ideas', 'i2')!.deletedAt).toBeNull(); expect(d.box('Ideas', 'i2')!.text).toBe('A가 나중에 수정'); }
  });

  it('오프라인에서 수정 → 온라인 복귀 시 정상 병합', async () => {
    A.remote.offline = true;
    A.setText('Schedule', 's1', '오프라인 수정');
    A.addBox('Schedule', { id: 'off1', text: '오프라인 새 상자' });
    await A.sync();
    expect(A.status).toBe('OFFLINE');
    B.addBox('Schedule', { id: 'on1', text: 'B 온라인 상자' });
    await B.sync();
    A.remote.offline = false;
    await A.sync(); await B.sync();
    expect(A.status).toBe('SYNCED');
    for (const d of [A, B]) {
      expect(d.box('Schedule', 's1')!.text).toBe('오프라인 수정');
      expect(d.box('Schedule', 'off1')).toBeTruthy();
      expect(d.box('Schedule', 'on1')).toBeTruthy();
    }
  });

  it('바뀐 카테고리만 업로드', async () => {
    const before = await rows<{ id: string; version: number }>(db, A.uid, 'select id, version from public.categories order by id');
    A.setText('Mind', 'm1', '하나만 바꿈');
    await A.sync();
    const after = await rows<{ id: string; version: number }>(db, A.uid, 'select id, version from public.categories order by id');
    const changed = after.filter((r, i) => r.version !== before[i].version);
    expect(changed.map(r => r.id)).toEqual([A.cat('Mind').id]);
  });

  it('카테고리 이름·순서 변경과 설정(항목별) 동기화', async () => {
    const id = A.cat('Custom 1').id;
    A.edit(d => ({ cats: d.cats.map(c => (c.id === id ? { ...c, name: 'Books', order: 0.5 } : c)) }));
    A.pb = { prefs: { ...A.pb.prefs, grain: 5 }, prefsT: { ...A.pb.prefsT, grain: tick() } };
    B.pb = { prefs: { ...B.pb.prefs, pulse: false }, prefsT: { ...B.pb.prefsT, pulse: tick() } };
    await A.sync(); await B.sync(); await A.sync();
    for (const d of [A, B]) {
      expect(d.data.cats.find(c => c.id === id)).toMatchObject({ name: 'Books', order: 0.5 });
      expect([d.pb.prefs.grain, d.pb.prefs.pulse]).toEqual([5, false]);
    }
  });

  it('사진: 서버에 없는 것만 올리고, 다른 기기는 필요할 때 받는다', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    await A.local.put('img-x', blob);
    A.addBox('Mind', { id: 'pic', type: 'image', imageId: 'img-x' });
    await A.sync();
    expect(A.metaBox.m!.uploaded['img-x']).toBe(1);
    await B.sync();
    expect(await B.local.get('img-x')).toBeUndefined();
    const got = await B.engine.fetchImage('img-x');
    expect(got && (await got.arrayBuffer()).byteLength).toBe(4);
    expect(await B.local.get('img-x')).toBeTruthy();
  });

  it('기기 연결 해제 후 그 기기는 서버 데이터에 접근 불가', async () => {
    const c = await newDevice(db, A.uid, 'C');
    const C = c.dev.connect(V.vault, true);
    await C.sync();
    expect(C.status).toBe('SYNCED');
    await one(db, A.uid, 'select public.remove_member($1)', [C.uid]);   // A에서 C 해제
    await C.sync();
    expect(C.revoked).toBe(true);
    expect(C.status).toBe('REVOKED');
    expect(await rows(db, C.uid, 'select * from public.categories')).toHaveLength(0);
    await expect(one(db, C.uid, `select public.put_category($1, 'x', '{}'::jsonb, 0)`, [V.vault])).rejects.toThrow(/not_member/);
    expect(C.box('Mind', 'm1')).toBeTruthy();   // 로컬 데이터는 그대로
  });

  it('마지막 열쇠는 해제할 수 없고, 계정 삭제는 보관함·데이터·열쇠를 모두 지운다', async () => {
    const W = await makeVault(db, 'lonely');
    await expect(one(db, W.idUser, 'select public.remove_member($1)', [W.idUser])).rejects.toThrow(/last_key/);
    await one(db, A.uid, 'select public.delete_vault()');
    expect((await db.query('select count(*)::int as n from public.categories where vault_id = $1', [V.vault])).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select count(*)::int as n from public.vault_members where vault_id = $1', [V.vault])).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select count(*)::int as n from auth.users where id = any($1)', [[A.uid, B.uid, V.idUser]])).rows[0]).toEqual({ n: 0 });
    expect((await db.query('select count(*)::int as n from public.vaults where id = $1', [W.vault])).rows[0]).toEqual({ n: 1 });
  });
});

// ═════════════════════════════════════════════════════════════════════
describe('기기 목록과 로그아웃', () => {
  let db: PGlite; let V: { idUser: string; vault: string };
  beforeAll(async () => { db = await makeDb(); V = await makeVault(db, 'multi'); });

  it('같은 아이디로 여러 기기에서 로그인해도 기기마다 따로 보인다', async () => {
    // 아이디 로그인 = 아이디 열쇠가 코드를 만들고 각 기기의 익명 열쇠가 수령 (loginWithId와 같은 순서)
    const p = await newDevice(db, V.idUser, 'Phone'), t = await newDevice(db, V.idUser, 'Tablet'), l = await newDevice(db, V.idUser, 'Laptop');
    const list = await rows<{ user_id: string; kind: string; device_name: string }>(db, p.uid, 'select user_id, kind, device_name from public.vault_members order by created_at');
    expect(list.filter(m => m.kind === 'password')).toHaveLength(1);
    expect(list.filter(m => m.kind === 'device').map(m => m.device_name).sort()).toEqual(['Laptop', 'Phone', 'Tablet']);
    expect(new Set(list.map(m => m.user_id)).size).toBe(list.length);
    // 한 기기만 해제하면 그 기기만 빠진다
    await one(db, p.uid, 'select public.remove_member($1)', [t.uid]);
    const after = await rows<{ device_name: string }>(db, l.uid, `select device_name from public.vault_members where kind = 'device'`);
    expect(after.map(m => m.device_name).sort()).toEqual(['Laptop', 'Phone']);
  });

  it('로그아웃 준비: 오프라인 변경은 대기로 남고, 온라인이면 올려서 0', async () => {
    const a = await newDevice(db, V.idUser, 'A', custom());
    const A = a.dev.connect(V.vault, false);
    await A.sync();
    expect(await A.engine.pendingCount()).toBe(0);
    A.remote.offline = true;
    A.setText('Mind', 'm1', '오프라인 수정');
    await A.local.put('img-o', new Blob([new Uint8Array([9])], { type: 'image/jpeg' }));
    A.addBox('Mind', { id: 'po', type: 'image', imageId: 'img-o' });
    await A.sync();
    expect(A.status).toBe('OFFLINE');
    expect(await A.engine.pendingCount()).toBe(2);   // Mind 카테고리 + 사진 1장
    A.remote.offline = false;
    await A.sync();
    expect(await A.engine.pendingCount()).toBe(0);
  });

  it('로그아웃 준비: 이 기기에 없는 사진을 받아 둔다', async () => {
    const a = await newDevice(db, V.idUser, 'Uploader', custom());
    const A = a.dev.connect(V.vault, false);
    await A.local.put('img-d', new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }));
    A.addBox('Mind', { id: 'pd', type: 'image', imageId: 'img-d' });
    await A.sync();
    const b = await newDevice(db, V.idUser, 'Viewer');
    const B = b.dev.connect(V.vault, true);
    await B.sync();
    expect(await B.local.get('img-d')).toBeUndefined();
    expect(await B.engine.downloadMissing()).toBe(0);
    expect(await B.local.get('img-d')).toBeTruthy();
  });

  it('로그아웃(데이터 유지) 뒤 다른 아이디로 로그인 → 처음 연결처럼 병합', async () => {
    const a = await newDevice(db, V.idUser, 'Leaver', custom());
    const A = a.dev.connect(V.vault, false);
    A.setText('Mind', 'm2', '첫 보관함의 내용');
    await A.sync();
    // 로그아웃: 이 기기 열쇠를 보관함에서 빼고 동기화 상태 초기화 (SyncService.logout과 같은 순서)
    A.engine.stop();
    await one(db, a.uid, 'select public.remove_member($1)', [a.uid]);
    A.metaBox.m = null;
    expect(await rows(db, V.idUser, 'select 1 from public.vault_members where user_id = $1', [a.uid])).toHaveLength(0);
    A.setText('Mind', 'm3', '로그아웃 뒤 로컬 수정');
    // 다른 아이디의 보관함(이미 데이터가 있음)으로 로그인
    const W = await makeVault(db, 'other');
    const o = await newDevice(db, W.idUser, 'OtherDev', custom());
    const O = o.dev.connect(W.vault, false);
    O.setText('Ideas', 'i1', '두 번째 보관함의 내용');
    await O.sync();
    const n = await newDevice(db, W.idUser, 'Leaver again', A.data);
    const N = n.dev.connect(W.vault, true);
    await N.sync(); await O.sync();
    // 서로 다른 보관함의 카테고리는 id가 달라 둘 다 남는다(덮어쓰지 않음). 양쪽 기기가 같은 내용으로 맞춰진다.
    const ids = (d: Device) => d.data.cats.filter(alive).map(c => c.id).sort();
    expect(ids(N)).toEqual(ids(O));
    for (const c of A.data.cats.filter(alive)) expect(ids(O)).toContain(c.id);
    const texts = (d: Device) => d.data.cats.filter(alive).flatMap(c => c.boxes.filter(alive).map(b => b.text));
    for (const d of [N, O]) expect(texts(d)).toEqual(expect.arrayContaining(['첫 보관함의 내용', '로그아웃 뒤 로컬 수정', '두 번째 보관함의 내용']));
    expect([N.status, O.status]).toEqual(['SYNCED', 'SYNCED']);
  });
});

void as;
