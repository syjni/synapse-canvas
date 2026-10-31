-- ════════════════════════════════════════════════════════════════════
-- RLS 확인용 (선택). schema.sql 실행 후 SQL Editor에서 이 파일 전체를 Run.
-- 가짜 사용자 2명과 보관함 2개를 만들어 서로의 데이터에 접근할 수 없는지 검사하고,
-- 마지막에 전부 되돌립니다(ROLLBACK) — 실제 데이터는 남지 않습니다.
-- 결과: 마지막 줄에 'RLS OK'가 보이면 통과. 실패하면 어떤 검사가 실패했는지 오류로 표시됩니다.
-- ════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  va uuid; vb uuid; n int; ok boolean;
begin
  insert into auth.users (id, email, is_anonymous) values (ua, 'rls_a@users.synapse.invalid', false), (ub, 'rls_b@users.synapse.invalid', false);

  -- 사용자 A로: 보관함 만들고 카테고리 하나 저장
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  va := public.create_vault('rls test A');
  perform public.put_category(va, 'cat-a', '{"secret": true}'::jsonb, 0);
  reset role;

  -- 사용자 B로: 자기 보관함 만들고 A의 것을 시도
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  vb := public.create_vault('rls test B');

  select count(*) into n from public.categories where vault_id = va;
  if n <> 0 then raise exception 'FAIL: B가 A의 categories를 읽음'; end if;
  select count(*) into n from public.vault_members where vault_id = va;
  if n <> 0 then raise exception 'FAIL: B가 A의 vault_members를 읽음'; end if;
  select count(*) into n from public.vaults where id = va;
  if n <> 0 then raise exception 'FAIL: B가 A의 vaults를 읽음'; end if;

  ok := false;
  begin perform public.put_category(va, 'evil', '{}'::jsonb, 0); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: B가 A의 보관함에 저장함'; end if;

  ok := false;
  begin insert into public.categories (vault_id, id, data) values (vb, 'direct', '{}'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: 테이블 직접 쓰기가 허용됨'; end if;

  ok := false;
  begin perform count(*) from public.pairing_codes; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL: pairing_codes 직접 읽기가 허용됨'; end if;

  ok := false;
  begin insert into storage.objects (bucket_id, name) values ('images', va::text || '/evil.jpg'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: B가 A의 사진 폴더에 씀'; end if;

  reset role;
  raise notice 'RLS OK';
end $$;

select 'RLS OK' as result;
rollback;
