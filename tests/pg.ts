// 테스트용 Supabase 대역: PGlite(WASM Postgres)에 auth/storage 최소 스텁을 깔고 supabase/schema.sql을 그대로 실행한다.
// 사용자 요청은 Supabase처럼 role=authenticated + request.jwt.claims(sub)로 실행 → RLS·security definer 함수가 실제와 같게 동작.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Remote, Member, LocalImages } from '../src/sync';
import type { ImageStore } from '../src/imageStore';
import type { Category } from '../src/model';
import type { PrefsBundle } from '../src/merge';

const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text unique, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant usage on schema public to anon, authenticated;
`;

export async function makeDb() {
  const db = new PGlite();
  await db.exec(STUB);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  return db;
}

export async function addUser(db: PGlite, opts: { anonymous?: boolean; login?: string } = {}) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)', [id, opts.login ? `${opts.login}@users.synapse.invalid` : null, !!opts.anonymous]);
  return id;
}

// 해당 사용자로 쿼리 실행 (Supabase의 PostgREST 요청과 같은 권한)
export function as<T>(db: PGlite, uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await tx.exec('set local role authenticated');
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    return fn(tx);
  });
}
export const one = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  as(db, uid, async tx => (await tx.query<T>(sql, params)).rows[0]);
export const rows = async <T = Record<string, unknown>>(db: PGlite, uid: string, sql: string, params: unknown[] = []) =>
  as(db, uid, async tx => (await tx.query<T>(sql, params)).rows);

// SyncEngine이 쓰는 Remote를 PGlite 위에 구현. offline=true면 네트워크 오류처럼 실패.
export class PgRemote implements Remote {
  offline = false;
  conflicts = 0;   // 조건부 저장이 거부(-1)된 횟수
  constructor(public db: PGlite, public uid: string) {}
  private net() { if (this.offline) throw new Error('TypeError: Failed to fetch'); }
  async userId() { return this.uid; }
  async membership() { this.net(); return (await one<Member>(this.db, this.uid, 'select * from public.vault_members where user_id = $1', [this.uid])) ?? null; }
  async listVersions(v: string) { this.net(); return rows<{ id: string; version: number }>(this.db, this.uid, 'select id, version from public.categories where vault_id = $1', [v]); }
  async fetchCategories(v: string, ids: string[]) { this.net(); return rows<{ id: string; version: number; data: Category }>(this.db, this.uid, 'select id, version, data from public.categories where vault_id = $1 and id = any($2)', [v, ids]); }
  async putCategory(v: string, id: string, data: Category, expected: number) {
    this.net();
    const r = (await one<{ v: number }>(this.db, this.uid, 'select public.put_category($1, $2, $3::jsonb, $4) as v', [v, id, JSON.stringify(data), expected]))!.v;
    if (r < 0) this.conflicts++;
    return r;
  }
  async getPrefs(v: string) { this.net(); return (await one<{ version: number; data: PrefsBundle }>(this.db, this.uid, 'select version, data from public.prefs where vault_id = $1', [v])) ?? null; }
  async putPrefs(v: string, data: PrefsBundle, expected: number) { this.net(); return (await one<{ v: number }>(this.db, this.uid, 'select public.put_prefs($1, $2::jsonb, $3) as v', [v, JSON.stringify(data), expected]))!.v; }
  async touch(name: string) { this.net(); await one(this.db, this.uid, 'select public.touch_device($1)', [name]); }
}

// Storage 대역: 객체 메타데이터는 storage.objects(RLS 정책 적용), 내용은 메모리
const blobs = new Map<string, Blob>();
export class PgImages implements ImageStore {
  constructor(public db: PGlite, public uid: string, public remote?: PgRemote) {}
  private net() { if (this.remote?.offline) throw new Error('TypeError: Failed to fetch'); }
  async put(v: string, id: string, blob: Blob) {
    this.net(); const name = `${v}/${id}.jpg`;
    await one(this.db, this.uid, `insert into storage.objects (bucket_id, name, owner) values ('images', $1, $2) on conflict (name) do nothing`, [name, this.uid]);
    blobs.set(name, blob);
  }
  async get(v: string, id: string) {
    this.net(); const name = `${v}/${id}.jpg`;
    const r = await one(this.db, this.uid, `select name from storage.objects where bucket_id = 'images' and name = $1`, [name]);
    return r ? blobs.get(name) ?? null : null;
  }
  async exists(v: string, ids: string[]) {
    this.net();
    const r = await rows<{ name: string }>(this.db, this.uid, `select name from storage.objects where bucket_id = 'images' and name like $1`, [`${v}/%`]);
    const have = new Set(r.map(x => x.name.split('/')[1].replace(/\.jpg$/, '')));
    return new Set(ids.filter(i => have.has(i)));
  }
  async delete(v: string, ids: string[]) { for (const id of ids) await one(this.db, this.uid, `delete from storage.objects where name = $1`, [`${v}/${id}.jpg`]); }
  async deleteAll(v: string) { await one(this.db, this.uid, `delete from storage.objects where name like $1`, [`${v}/%`]); }
}

export const memLocalImages = (): LocalImages & { map: Map<string, Blob> } => {
  const map = new Map<string, Blob>();
  return { map, get: async id => map.get(id), put: async (id, b) => { map.set(id, b); } };
};
