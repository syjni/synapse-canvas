-- ════════════════════════════════════════════════════════════════════
-- Dendra (구 Synapse Canvas) — Supabase 스키마
-- Supabase 대시보드 > SQL Editor에 이 파일 전체를 붙여넣고 Run 하면 끝납니다.
-- 여러 번 실행해도 안전합니다(이미 있는 것은 그대로 두거나 새로 덮어씀).
--
-- 구조
--   vaults          보관함 (데이터 묶음 단위)
--   vault_members   보관함에 붙은 "열쇠"(Supabase 사용자). 기기마다 익명 사용자 1개 + 아이디 열쇠 1개
--   categories      카테고리 하나를 통째로 JSON(data)으로. version으로 조건부 저장
--   prefs           설정 JSON. version으로 조건부 저장
--   pairing_codes   5분짜리 일회용 6자리 기기 연결 코드 (함수로만 접근)
--   storage 버킷 'images'   비공개, 경로 {vault_id}/{imageId}.jpg
--
-- 쓰기는 모두 아래 security definer 함수로만 합니다. 테이블에는 같은 보관함 멤버의 읽기만 열려 있습니다(RLS).
-- ════════════════════════════════════════════════════════════════════

-- ── 테이블 ───────────────────────────────────────────────────────────
create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.vault_members (
  vault_id uuid not null references public.vaults(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('password', 'device')),   -- password = 아이디 열쇠, device = 기기 열쇠(익명)
  login_id text,                                                -- 아이디 열쇠일 때 사용자에게 보이는 아이디
  device_name text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (vault_id, user_id)
);
-- 열쇠 하나는 보관함 하나에만
create unique index if not exists vault_members_one_vault on public.vault_members(user_id);

create table if not exists public.categories (
  vault_id uuid not null references public.vaults(id) on delete cascade,
  id text not null,
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (vault_id, id)
);

create table if not exists public.prefs (
  vault_id uuid primary key references public.vaults(id) on delete cascade,
  data jsonb not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.pairing_codes (
  code text primary key,
  vault_id uuid not null references public.vaults(id) on delete cascade,
  created_by uuid not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  used_at timestamptz,
  used_by uuid
);

create table if not exists public.pairing_failures (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists pairing_failures_user on public.pairing_failures(user_id, at);

-- ── 도우미 ──────────────────────────────────────────────────────────
-- 지금 로그인한 열쇠의 보관함 id (RLS 정책에서 사용, 정책 재귀를 피하려고 security definer)
create or replace function public.my_vault_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select vault_id from public.vault_members where user_id = auth.uid() limit 1
$$;

create or replace function public._key_kind(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(u.is_anonymous, false) then 'device' else 'password' end from auth.users u where u.id = uid
$$;

create or replace function public._login_id(uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when coalesce(u.is_anonymous, false) then null else split_part(u.email, '@', 1) end from auth.users u where u.id = uid
$$;

-- 사용자 삭제 (실패해도 진행: 멤버십이 지워지면 이미 데이터에 접근할 수 없다)
create or replace function public._drop_user(uid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  begin
    delete from auth.users where id = uid;
  exception when others then
    null;
  end;
end $$;

-- ── RPC: 보관함 ─────────────────────────────────────────────────────
-- 새 보관함을 만들고 지금 열쇠를 첫 멤버로 등록
create or replace function public.create_vault(p_device text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  v uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.vault_members where user_id = uid) then raise exception 'already_member'; end if;
  insert into public.vaults default values returning id into v;
  insert into public.vault_members (vault_id, user_id, kind, login_id, device_name)
  values (v, uid, public._key_kind(uid), public._login_id(uid), coalesce(p_device, ''));
  return v;
end $$;

-- 기기 이름·마지막 접속 갱신
create or replace function public.touch_device(p_device text) returns void
language sql security definer set search_path = '' as $$
  update public.vault_members
     set last_seen_at = now(),
         device_name = coalesce(nullif(p_device, ''), device_name)
   where user_id = auth.uid()
$$;

-- 열쇠 제거 (기기 연결 해제, 이전 아이디 열쇠 제거). 마지막 열쇠는 지울 수 없다.
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := public.my_vault_id();
begin
  if v is null then raise exception 'not_member'; end if;
  if not exists (select 1 from public.vault_members where vault_id = v and user_id = p_user) then raise exception 'not_found'; end if;
  if (select count(*) from public.vault_members where vault_id = v) <= 1 then raise exception 'last_key'; end if;
  delete from public.vault_members where vault_id = v and user_id = p_user;
  delete from public.pairing_codes where created_by = p_user;
  perform public._drop_user(p_user);
end $$;

-- 계정 삭제: 보관함과 모든 서버 데이터, 모든 열쇠(사용자) 삭제.
-- 사진 파일은 앱이 먼저 Storage API로 지운다(Storage 테이블은 SQL로 직접 지우지 않는다).
create or replace function public.delete_vault() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := public.my_vault_id();
  u uuid;
begin
  if v is null then raise exception 'not_member'; end if;
  for u in select user_id from public.vault_members where vault_id = v loop
    perform public._drop_user(u);
  end loop;
  delete from public.vaults where id = v;
end $$;

-- ── RPC: 기기 연결 코드 ─────────────────────────────────────────────
-- 5분짜리 일회용 6자리 코드. 같은 열쇠가 만든 이전 코드는 무효가 된다.
create or replace function public.create_pairing() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v uuid := public.my_vault_id();
  c text;
  exp timestamptz := now() + interval '5 minutes';
begin
  if v is null then raise exception 'not_member'; end if;
  delete from public.pairing_codes
   where created_by = auth.uid() or expires_at < now() - interval '1 day' or used_at is not null;
  loop
    c := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.pairing_codes where code = c);
  end loop;
  insert into public.pairing_codes (code, vault_id, created_by, expires_at) values (c, v, auth.uid(), exp);
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;

-- 코드로 지금 열쇠를 같은 보관함에 추가.
-- 실패 제한: 열쇠당 10분에 5회. 틀린 입력이 있을 때마다 그 시점에 유효한 코드들의 시도 횟수가 1 늘고, 5회가 되면 그 코드는 무효.
-- 성공·만료된 코드는 즉시 쓸 수 없다. 실패해도 기록이 남도록 예외 대신 결과 JSON을 돌려준다.
create or replace function public.claim_pairing(p_code text, p_device text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r public.pairing_codes;
  cur uuid;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select vault_id into cur from public.vault_members where user_id = uid;
  if cur is not null then return jsonb_build_object('ok', false, 'error', 'already_member', 'vault_id', cur); end if;
  delete from public.pairing_failures where at < now() - interval '1 day';
  if (select count(*) from public.pairing_failures where user_id = uid and at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;
  select * into r from public.pairing_codes
   where code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g')
     and used_at is null and expires_at > now() and attempts < 5
   for update;
  if not found then
    insert into public.pairing_failures (user_id) values (uid);
    update public.pairing_codes set attempts = attempts + 1 where used_at is null and expires_at > now();
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  update public.pairing_codes set used_at = now(), used_by = uid where code = r.code;
  insert into public.vault_members (vault_id, user_id, kind, login_id, device_name)
  values (r.vault_id, uid, public._key_kind(uid), public._login_id(uid), coalesce(p_device, ''));
  return jsonb_build_object('ok', true, 'vault_id', r.vault_id);
end $$;

-- ── RPC: 조건부 저장 ────────────────────────────────────────────────
-- p_expected = 내가 마지막으로 받은 version (처음이면 0). 서버 version과 같을 때만 저장하고 version+1.
-- 다르면 -1 → 앱이 다시 받아서 병합 후 재시도.
create or replace function public.put_category(p_vault uuid, p_id text, p_data jsonb, p_expected int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  nv int;
begin
  if p_vault is null or p_vault is distinct from public.my_vault_id() then raise exception 'not_member'; end if;
  if p_expected = 0 then
    insert into public.categories (vault_id, id, data, version) values (p_vault, p_id, p_data, 1)
    on conflict (vault_id, id) do nothing;
    if found then return 1; end if;
    return -1;
  end if;
  update public.categories set data = p_data, version = version + 1, updated_at = now()
   where vault_id = p_vault and id = p_id and version = p_expected
  returning version into nv;
  return coalesce(nv, -1);
end $$;

create or replace function public.put_prefs(p_vault uuid, p_data jsonb, p_expected int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  nv int;
begin
  if p_vault is null or p_vault is distinct from public.my_vault_id() then raise exception 'not_member'; end if;
  if p_expected = 0 then
    insert into public.prefs (vault_id, data, version) values (p_vault, p_data, 1)
    on conflict (vault_id) do nothing;
    if found then return 1; end if;
    return -1;
  end if;
  update public.prefs set data = p_data, version = version + 1, updated_at = now()
   where vault_id = p_vault and version = p_expected
  returning version into nv;
  return coalesce(nv, -1);
end $$;

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.vaults enable row level security;
alter table public.vault_members enable row level security;
alter table public.categories enable row level security;
alter table public.prefs enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.pairing_failures enable row level security;

drop policy if exists "vault members read vault" on public.vaults;
create policy "vault members read vault" on public.vaults for select to authenticated using (id = public.my_vault_id());
drop policy if exists "vault members read members" on public.vault_members;
create policy "vault members read members" on public.vault_members for select to authenticated using (vault_id = public.my_vault_id());
drop policy if exists "vault members read categories" on public.categories;
create policy "vault members read categories" on public.categories for select to authenticated using (vault_id = public.my_vault_id());
drop policy if exists "vault members read prefs" on public.prefs;
create policy "vault members read prefs" on public.prefs for select to authenticated using (vault_id = public.my_vault_id());
-- pairing_codes / pairing_failures: 정책 없음 = 직접 접근 불가 (함수로만)

-- 직접 쓰기는 막고 읽기만 (쓰기는 위 함수로)
revoke all on public.vaults, public.vault_members, public.categories, public.prefs, public.pairing_codes, public.pairing_failures from anon, authenticated;
grant select on public.vaults, public.vault_members, public.categories, public.prefs to authenticated;

-- 함수 실행 권한: 로그인한 사용자만 (익명 로그인도 authenticated)
revoke all on function public.my_vault_id(), public._key_kind(uuid), public._login_id(uuid), public._drop_user(uuid),
  public.create_vault(text), public.touch_device(text), public.remove_member(uuid), public.delete_vault(),
  public.create_pairing(), public.claim_pairing(text, text), public.put_category(uuid, text, jsonb, int), public.put_prefs(uuid, jsonb, int)
  from public, anon;
grant execute on function public.my_vault_id(), public.create_vault(text), public.touch_device(text), public.remove_member(uuid),
  public.delete_vault(), public.create_pairing(), public.claim_pairing(text, text), public.put_category(uuid, text, jsonb, int),
  public.put_prefs(uuid, jsonb, int)
  to authenticated;
revoke all on function public._key_kind(uuid), public._login_id(uuid), public._drop_user(uuid) from authenticated;

-- ── Storage: 비공개 버킷 'images', 경로 {vault_id}/{imageId}.jpg ─────
insert into storage.buckets (id, name, public) values ('images', 'images', false)
on conflict (id) do update set public = false;

drop policy if exists "synapse images read" on storage.objects;
create policy "synapse images read" on storage.objects for select to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = public.my_vault_id()::text);
drop policy if exists "synapse images insert" on storage.objects;
create policy "synapse images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = public.my_vault_id()::text);
drop policy if exists "synapse images update" on storage.objects;
create policy "synapse images update" on storage.objects for update to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = public.my_vault_id()::text)
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = public.my_vault_id()::text);
drop policy if exists "synapse images delete" on storage.objects;
create policy "synapse images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = public.my_vault_id()::text);
