import { it, expect } from 'vitest';
import { supabaseRemote, SyncEngine, type Host } from '../src/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { seed, DEF_PREFS, zeroPrefsT } from '../src/model';

// 서버 일시정지 중 토큰 갱신이 네트워크 오류로 실패해도 "연결 해제"로 오판해 열쇠를 지우면 안 된다
const fakeSb = (getSession: () => unknown) => ({ auth: { getSession: async () => getSession() } }) as unknown as SupabaseClient;
const host: Host = { getData: () => seed(), getPrefs: () => ({ prefs: DEF_PREFS, prefsT: zeroPrefsT() }), applyRemote: async () => {} };
const engineWith = (sb: SupabaseClient) => {
  const out = { revoked: false, status: '' };
  const e = new SyncEngine({
    remote: supabaseRemote(sb), images: {} as never, local: {} as never, host, retryDelay: 1e9,
    metaStore: { load: () => null, save: () => {}, clear: () => {} },
    meta: { vaultId: 'v', deviceName: 'd', firstSync: false, versions: {}, synced: {}, prefsVersion: 0, prefsHash: '', uploaded: {} },
    onStatus: s => { out.status = s; }, onRevoked: () => { out.revoked = true; },
  });
  return { e, out };
};

it('토큰 갱신 네트워크 오류 → OFFLINE (열쇠 유지)', async () => {
  const err = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
  const { e, out } = engineWith(fakeSb(() => ({ data: { session: null }, error: err })));
  await e.syncNow();
  expect(out).toEqual({ revoked: false, status: 'OFFLINE' });
});

it('갱신 토큰 거부(열쇠 삭제됨) → REVOKED', async () => {
  const err = Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400 });
  const { e, out } = engineWith(fakeSb(() => ({ data: { session: null }, error: err })));
  await e.syncNow();
  expect(out).toEqual({ revoked: true, status: 'REVOKED' });
});
