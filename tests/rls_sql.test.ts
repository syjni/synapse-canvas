import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeDb } from './pg';

// supabase/rls_test.sql 자체가 통과하는지 (대시보드에서 돌릴 파일과 같은 내용)
it('supabase/rls_test.sql 통과', async () => {
  const db = await makeDb();
  const res = await db.exec(readFileSync(new URL('../supabase/rls_test.sql', import.meta.url), 'utf8'));
  const out = res.flatMap(r => r.rows);
  expect(out).toContainEqual({ result: 'RLS OK' });
  expect((await db.query('select count(*)::int as n from public.vaults')).rows[0]).toEqual({ n: 0 });  // 롤백됨
});
