// ════════════════════════════════════════════════════════════════════
// Supabase 동기화 (선택 기능)
// - 로그인하지 않았거나 서버가 응답하지 않아도 앱은 1단계 그대로 동작한다. 이 파일은 storage.ts를 고치지 않고
//   공개 함수(getImage/putImage)만 쓴다.
// - 기기마다 "기기 열쇠"(Supabase 익명 사용자) 하나를 갖는다. 아이디·비밀번호는 별도의 "아이디 열쇠"(이메일 사용자)로,
//   새 기기를 보관함에 붙일 때만 잠깐 쓰고(임시 클라이언트) 기기에는 남기지 않는다.
//   → 기기마다 멤버 한 줄이 생겨 기기별 연결 해제·마지막 접속 표시가 가능하다.
// ════════════════════════════════════════════════════════════════════
// supabase-js는 동기화를 쓸 때만 따로 불러온다(첫 화면 번들을 가볍게) — 여기서는 타입만
import type { SupabaseClient, SupportedStorage, createClient as CreateClient } from '@supabase/supabase-js';
import { alive, type Category, type Data } from './model';
import { stableStringify, isPristineSeed, type PrefsBundle } from './merge';
import { createImageStore, type ImageStore } from './imageStore';

// ── 서버 접근 (테스트에서 다른 구현으로 바꿔 끼울 수 있게 인터페이스로) ──
export type Member = { vault_id: string; user_id: string; kind: 'password' | 'device'; login_id: string | null; device_name: string; created_at: string; last_seen_at: string };
export interface Remote {
  userId(): Promise<string | null>;
  membership(): Promise<Member | null>;
  listVersions(vaultId: string): Promise<{ id: string; version: number }[]>;
  fetchCategories(vaultId: string, ids: string[]): Promise<{ id: string; version: number; data: Category }[]>;
  putCategory(vaultId: string, id: string, data: Category, expected: number): Promise<number>;
  getPrefs(vaultId: string): Promise<{ version: number; data: PrefsBundle } | null>;
  putPrefs(vaultId: string, data: PrefsBundle, expected: number): Promise<number>;
  touch(deviceName: string): Promise<void>;
}

export class SyncError extends Error {
  constructor(message: string, public code = '', public status = 0) { super(message); }
}
type SbErr = { message?: string; code?: string; status?: number } | null;
const fail = (e: SbErr): never => { throw new SyncError(e?.message || 'error', e?.code || '', e?.status || 0); };

// 네트워크·서버 문제(일시정지 포함)인지: 이런 오류로는 절대 "연결 해제됨"으로 판단하지 않는다
export const isRetryable = (e: { name?: string; status?: number } | null | undefined) =>
  !!e && (e.name === 'AuthRetryableFetchError' || !e.status || e.status >= 500 || e.status === 408 || e.status === 429);

export function supabaseRemote(sb: SupabaseClient): Remote {
  // 세션 확인. 토큰 갱신이 네트워크 문제로 실패하면 null이 아니라 예외(→ OFFLINE)로 올린다.
  // 갱신 토큰 자체가 거부된 경우(열쇠가 삭제됨)만 null(→ 연결 해제됨).
  const uid = async () => {
    const { data, error } = await sb.auth.getSession();
    if (error) { if (isRetryable(error)) throw new SyncError(error.message, 'offline', error.status || 0); return null; }
    return data.session?.user.id ?? null;
  };
  return {
    userId: uid,
    async membership() {
      const id = await uid(); if (!id) return null;
      const { data, error } = await sb.from('vault_members').select('*').eq('user_id', id).maybeSingle();
      if (error) fail(error);
      return data as Member | null;
    },
    async listVersions(vaultId) {
      const { data, error } = await sb.from('categories').select('id,version').eq('vault_id', vaultId);
      if (error) fail(error);
      return data || [];
    },
    async fetchCategories(vaultId, ids) {
      const out: { id: string; version: number; data: Category }[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const { data, error } = await sb.from('categories').select('id,version,data').eq('vault_id', vaultId).in('id', ids.slice(i, i + 50));
        if (error) fail(error);
        out.push(...((data || []) as typeof out));
      }
      return out;
    },
    async putCategory(vaultId, id, data, expected) {
      const { data: v, error } = await sb.rpc('put_category', { p_vault: vaultId, p_id: id, p_data: data, p_expected: expected });
      if (error) fail(error);
      return v as number;
    },
    async getPrefs(vaultId) {
      const { data, error } = await sb.from('prefs').select('version,data').eq('vault_id', vaultId).maybeSingle();
      if (error) fail(error);
      return data as { version: number; data: PrefsBundle } | null;
    },
    async putPrefs(vaultId, data, expected) {
      const { data: v, error } = await sb.rpc('put_prefs', { p_vault: vaultId, p_data: data, p_expected: expected });
      if (error) fail(error);
      return v as number;
    },
    async touch(deviceName) {
      const { error } = await sb.rpc('touch_device', { p_device: deviceName });
      if (error) fail(error);
    },
  };
}

// ── 동기화 엔진 ─────────────────────────────────────────────────────
export type SyncStatus = 'off' | 'SYNCED' | 'SYNCING…' | 'OFFLINE' | 'REVOKED';

// 화면(Canvas)이 엔진에 제공하는 것
export interface Host {
  getData(): Data;
  getPrefs(): PrefsBundle;
  // 받은 카테고리·설정을 현재 상태에 병합해 저장한다. replace=true면 로컬 카테고리를 버리고 받은 것으로 교체(초기 예시 데이터일 때).
  applyRemote(cats: Category[], prefs: PrefsBundle | null, replace?: boolean): Promise<void>;
}
export interface LocalImages { get(id: string): Promise<Blob | undefined>; put(id: string, blob: Blob): Promise<void> }

// 기기에 남기는 동기화 상태. 업로드 대기열은 "현재 내용의 해시 ≠ 마지막으로 서버와 맞춘 해시"로 표현되므로
// 오프라인에서 바꾼 내용도 다시 켜면 그대로 올라간다.
export type Meta = {
  vaultId: string; deviceName: string; firstSync: boolean;
  via?: 'id' | 'code';   // 이 기기를 연결한 방법 (로그아웃 안내 문구용). 이전 버전 기록에는 없음
  versions: Record<string, number>; synced: Record<string, string>;
  prefsVersion: number; prefsHash: string; uploaded: Record<string, 1>;
};
export interface MetaStore { load(): Meta | null; save(m: Meta): void; clear(): void }

export const localMetaStore = (key = 'synapse-sync-v1'): MetaStore => ({
  load() { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } },
  save(m) { try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* 공간 부족 시 다음 저장에서 다시 */ } },
  clear() { try { localStorage.removeItem(key); } catch { /* 무시 */ } },
});

// 53비트 FNV 계열 해시 (내용 비교용)
const hash = (v: unknown) => {
  const s = stableStringify(v);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export class SyncEngine {
  meta: Meta;
  status: SyncStatus = 'SYNCING…';
  private running: Promise<void> | null = null;
  private again = false;
  private pushT: ReturnType<typeof setTimeout> | null = null;
  private retryT: ReturnType<typeof setTimeout> | null = null;
  private lastTouch = 0;
  stopped = false;

  constructor(private o: {
    remote: Remote; images: ImageStore; local: LocalImages; metaStore: MetaStore; host: Host; meta: Meta;
    onStatus: (s: SyncStatus) => void; onRevoked: () => void; pushDelay?: number; retryDelay?: number;
  }) { this.meta = o.meta; }

  private setStatus(s: SyncStatus) { if (this.status !== s) { this.status = s; this.o.onStatus(s); } }
  private save() { this.o.metaStore.save(this.meta); }

  // 로컬 저장 후 호출 → 3초 뒤 바뀐 카테고리만 업로드
  requestPush() {
    if (this.stopped) return;
    if (this.pushT) clearTimeout(this.pushT);
    this.pushT = setTimeout(() => { this.pushT = null; this.run(false); }, this.o.pushDelay ?? 3000);
  }
  // 시작·포커스·온라인 복귀 시: 원격 확인 + 업로드
  syncNow() { return this.run(true); }
  stop() { this.stopped = true; if (this.pushT) clearTimeout(this.pushT); if (this.retryT) clearTimeout(this.retryT); }

  // 동시에 하나만 돈다. 도는 중에 요청이 오면 끝난 뒤 한 번 더.
  private run(pull: boolean): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) { this.again = true; this.pullAgain = this.pullAgain || pull; return this.running; }
    this.running = (async () => {
      this.setStatus('SYNCING…');
      try {
        if (pull) await this.pull();
        if (this.stopped) return;
        await this.push();
        if (this.stopped) return;
        this.setStatus('SYNCED');
      } catch (e) {
        if (this.stopped) return;
        this.setStatus('OFFLINE');
        if (this.retryT) clearTimeout(this.retryT);
        this.retryT = setTimeout(() => this.run(true), this.o.retryDelay ?? 30000);
        void e;
      }
    })().finally(() => {
      this.running = null;
      if (this.again && !this.stopped) { const p = this.pullAgain; this.again = false; this.pullAgain = false; this.run(p); }
    });
    return this.running;
  }
  private pullAgain = false;

  private async checkMember(): Promise<boolean> {
    const m = await this.o.remote.membership();
    if (!m || m.vault_id !== this.meta.vaultId) {
      this.stop(); this.setStatus('REVOKED'); this.o.onRevoked();
      return false;
    }
    if (Date.now() - this.lastTouch > 60000) { this.lastTouch = Date.now(); await this.o.remote.touch(this.meta.deviceName); }
    return true;
  }

  async pull() {
    if (!(await this.checkMember())) throw new SyncError('revoked', 'revoked');
    const { remote, host } = this.o, v = this.meta.vaultId;
    const vers = await remote.listVersions(v);
    const need = vers.filter(r => this.meta.versions[r.id] !== r.version).map(r => r.id);
    const rows = need.length ? await remote.fetchCategories(v, need) : [];
    const p = await remote.getPrefs(v);
    const newPrefs = p && p.version !== this.meta.prefsVersion ? p : null;
    // 새 기기의 첫 동기화: 고치지 않은 초기 예시 데이터는 병합하지 않고 보관함 내용으로 교체
    const replace = this.meta.firstSync && vers.length > 0 && isPristineSeed(host.getData());
    if (rows.length || newPrefs || replace) {
      const all = replace && rows.length < vers.length ? [...rows, ...(await remote.fetchCategories(v, vers.map(r => r.id).filter(id => !need.includes(id))))] : rows;
      await host.applyRemote(all.map(r => r.data), newPrefs ? newPrefs.data : null, replace);
      for (const r of all) { this.meta.versions[r.id] = r.version; this.meta.synced[r.id] = hash(r.data); }
      if (newPrefs) { this.meta.prefsVersion = newPrefs.version; this.meta.prefsHash = hash(newPrefs.data); }
    }
    if (this.meta.firstSync) this.meta.firstSync = false;
    this.save();
  }

  async push() {
    const { remote, host } = this.o, v = this.meta.vaultId;
    for (const c0 of host.getData().cats) {
      if (this.stopped) return;
      if (this.meta.synced[c0.id] === hash(c0)) continue;
      // 조건부 저장: 내가 받은 version과 서버 version이 같을 때만. 실패하면 다시 받아 병합 후 재시도.
      for (let attempt = 0; ; attempt++) {
        const cur = host.getData().cats.find(c => c.id === c0.id); if (!cur) break;
        const h = hash(cur);
        const nv = await remote.putCategory(v, cur.id, cur, this.meta.versions[cur.id] || 0);
        if (nv > 0) { this.meta.versions[cur.id] = nv; this.meta.synced[cur.id] = h; this.save(); break; }
        if (attempt >= 5) throw new SyncError('conflict', 'conflict');
        const rows = await remote.fetchCategories(v, [cur.id]);
        if (rows.length) {
          await host.applyRemote(rows.map(r => r.data), null);
          this.meta.versions[cur.id] = rows[0].version; this.meta.synced[cur.id] = hash(rows[0].data);
        } else { this.meta.versions[cur.id] = 0; }
      }
      await this.uploadImages(host.getData().cats.find(c => c.id === c0.id));
    }
    const pb = host.getPrefs();
    if (this.meta.prefsHash !== hash(pb)) {
      for (let attempt = 0; ; attempt++) {
        const cur = host.getPrefs(), h = hash(cur);
        const nv = await remote.putPrefs(v, cur, this.meta.prefsVersion || 0);
        if (nv > 0) { this.meta.prefsVersion = nv; this.meta.prefsHash = h; this.save(); break; }
        if (attempt >= 5) throw new SyncError('conflict', 'conflict');
        const p = await remote.getPrefs(v);
        if (p) { await host.applyRemote([], p.data); this.meta.prefsVersion = p.version; this.meta.prefsHash = hash(p.data); }
        else this.meta.prefsVersion = 0;
      }
    }
  }

  // 서버에 없는 사진만 올린다
  private async uploadImages(c: Category | undefined) {
    if (!c) return;
    const ids = c.boxes.filter(b => b.deletedAt == null && b.imageId && !this.meta.uploaded[b.imageId]).map(b => b.imageId!);
    if (!ids.length) return;
    const have = await this.o.images.exists(this.meta.vaultId, ids);
    for (const id of ids) {
      if (!have.has(id)) {
        const blob = await this.o.local.get(id);
        if (!blob) continue;   // 이 기기에도 없는 사진(다른 기기에서 아직 안 올림)은 건너뜀
        await this.o.images.put(this.meta.vaultId, id, blob);
      }
      this.meta.uploaded[id] = 1;
    }
    this.save();
  }

  // 로컬에 없는 사진은 필요할 때 받아서 기기 저장소에 넣는다
  // 아직 서버에 올라가지 않은 변경 수: 내용이 바뀐 카테고리, 설정, 이 기기에만 있는 사진
  async pendingCount() {
    const d = this.o.host.getData();
    let n = d.cats.filter(c => this.meta.synced[c.id] !== hash(c)).length;
    if (this.meta.prefsHash !== hash(this.o.host.getPrefs())) n++;
    for (const id of liveImageIds(d)) if (!this.meta.uploaded[id] && (await this.o.local.get(id))) n++;
    return n;
  }
  // 이 기기에 없는 사진을 서버에서 받아 둔다 (로그아웃 뒤 이 기기만으로 쓸 수 있게). 받지 못한 수를 돌려준다.
  // deadline이 지나면 남은 사진은 받지 않고 못 받은 것으로 센다.
  async downloadMissing(deadline = Infinity) {
    let miss = 0;
    for (const id of liveImageIds(this.o.host.getData())) {
      if (await this.o.local.get(id)) continue;
      if (Date.now() > deadline || !(await this.fetchImage(id))) miss++;
    }
    return miss;
  }

  async fetchImage(id: string): Promise<Blob | null> {
    const b = await this.o.images.get(this.meta.vaultId, id).catch(() => null);
    if (b) { await this.o.local.put(id, b); this.meta.uploaded[id] = 1; this.save(); }
    return b;
  }
}

// ── 아이디 ↔ 이메일 ─────────────────────────────────────────────────
const liveImageIds = (d: Data) => {
  const ids = new Set<string>();
  for (const c of d.cats) if (alive(c)) for (const b of c.boxes) if (alive(b) && b.imageId) ids.add(b.imageId);
  return ids;
};

export const ID_RE = /^[a-z0-9_]{4,20}$/;
export const idToEmail = (id: string) => `${id}@users.synapse.invalid`;
export const checkId = (id: string) => (ID_RE.test(id) ? null : '아이디는 영문 소문자·숫자·_ 4~20자입니다.');
export const checkPw = (pw: string) => (pw.length >= 6 ? null : '비밀번호는 6자 이상입니다.');

// Supabase 오류 → 화면 문구. error_code(code)를 먼저 보고, 예전 버전처럼 code가 없으면 메시지로 판단한다.
// 아이디는 내부에서 가짜 이메일로 바뀌므로 화면 문구에는 "이메일"이라는 말을 쓰지 않는다.
const RATE_CODES = ['over_request_rate_limit', 'over_email_send_rate_limit', 'over_sms_send_rate_limit'];
const errParts = (e: unknown) => ({
  m: String((e as { message?: string })?.message || e || ''),
  c: String((e as { code?: string })?.code || ''),
  st: Number((e as { status?: number })?.status || 0),
});
// 요청이 너무 많음(429) — 화면에서 버튼을 잠시 잠근다
export function isRateLimited(e: unknown) {
  const { m, c, st } = errParts(e);
  return st === 429 || RATE_CODES.includes(c) || /rate limit/i.test(m);
}
export function friendly(e: unknown): string {
  const { m, c } = errParts(e);
  const has = (re: RegExp) => re.test(c) || re.test(m);
  if (isRateLimited(e)) return '잠시 후 다시 시도해주세요';
  if (has(/^(user_already_exists|email_exists)$|already registered|already exists/i)) return '이미 사용 중인 아이디예요';
  if (has(/^weak_password$/)) return '비밀번호가 너무 짧아요 (6자 이상)';
  if (has(/^invalid_credentials$|invalid login credentials/i)) return '아이디 또는 비밀번호가 맞지 않아요';
  if (has(/^same_password$|should be different/i)) return '새 비밀번호가 이전과 같아요';
  if (has(/^email_address_invalid$/)) return '쓸 수 없는 아이디예요';
  if (has(/^captcha_failed$|captcha/i)) return '사람 확인(CAPTCHA)에 실패했어요. 다시 시도해주세요';
  if (has(/^anonymous_provider_disabled$|anonymous sign-ins are disabled/i)) return '서버에서 익명 로그인이 꺼져 있어요 (DEPLOY.md 2단계 참고)';
  if (has(/^signup_disabled$|signups not allowed/i)) return '서버에서 가입이 꺼져 있어요 (DEPLOY.md 2단계 참고)';
  if (has(/^email_not_confirmed$|email not confirmed/i)) return '서버 설정 때문에 가입을 마칠 수 없어요 (DEPLOY.md 2단계의 확인 기능 끄기 참고)';
  if (has(/invalid_code/)) return '코드가 맞지 않거나 만료되었어요';
  if (has(/too_many_attempts/)) return '시도가 너무 많아요. 10분 뒤 다시 해주세요';
  if (has(/last_key/)) return '마지막 열쇠는 해제할 수 없어요. 계정 삭제를 사용하세요';
  if (has(/fetch|network|load failed|timeout|^offline$/i)) return '서버에 연결할 수 없어요. 인터넷 연결 또는 서버 상태(일시정지)를 확인하세요';
  console.error('[PixieMap] 동기화 오류', c || '(code 없음)', m);
  return '연결에 실패했어요';
}

export function defaultDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '기기';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} ${br}` : os;
}

// ── 서비스: 클라이언트·엔진·열쇠 관리 ─────────────────────────────────
export type Captcha = () => Promise<string | undefined>;
export type SyncConfig = { url: string; key: string; createClient: typeof CreateClient; storage?: SupportedStorage; metaStore?: MetaStore; local: LocalImages; pushDelay?: number; retryDelay?: number };
type Listener = () => void;
const AUTH_KEY = 'synapse-auth';

export class SyncService {
  sb: SupabaseClient;
  remote: Remote;
  images: ImageStore;
  engine: SyncEngine | null = null;
  metaStore: MetaStore;
  host: Host | null = null;
  status: SyncStatus = 'off';
  revokedNotice = false;
  private listeners = new Set<Listener>();

  constructor(private cfg: SyncConfig) {
    this.sb = cfg.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY, storage: cfg.storage } });
    this.remote = supabaseRemote(this.sb);
    this.images = createImageStore(this.sb);
    this.metaStore = cfg.metaStore || localMetaStore();
  }

  subscribe(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private emit() { this.listeners.forEach(f => f()); }
  get meta() { return this.engine?.meta ?? this.metaStore.load(); }
  get connected() { return !!this.meta?.vaultId; }

  // 화면이 준비되면 붙인다. 이미 연결된 기기면 바로 동기화 시작.
  attach(host: Host) {
    this.host = host;
    const m = this.metaStore.load();
    if (m && m.vaultId) this.startEngine(m);
  }
  private startEngine(meta: Meta) {
    this.engine?.stop();
    this.engine = new SyncEngine({
      remote: this.remote, images: this.images, local: this.cfg.local, metaStore: this.metaStore, host: this.host!, meta,
      pushDelay: this.cfg.pushDelay, retryDelay: this.cfg.retryDelay,
      onStatus: s => { this.status = s; this.emit(); },
      onRevoked: () => { void this.forgetDevice(true); },
    });
    this.status = 'SYNCING…'; this.emit();
    return this.engine.syncNow();
  }
  // 이 기기의 동기화 정보만 지운다 (로컬 맵 데이터는 그대로)
  private async forgetDevice(revoked: boolean) {
    this.engine?.stop(); this.engine = null;
    this.metaStore.clear();
    await this.dropSession();
    this.status = revoked ? 'REVOKED' : 'off';
    this.revokedNotice = revoked;
    this.emit();
  }
  // 기기에 저장된 세션을 지운다. 오프라인이면 supabase-js의 signOut이 토큰 갱신 실패로 세션을 남긴 채 끝나므로 저장소에서 직접 지운다.
  private async dropSession() {
    const r = await this.sb.auth.signOut({ scope: 'local' }).catch(error => ({ error }));
    if (!r.error) return;
    const st = this.cfg.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    for (const k of [AUTH_KEY, AUTH_KEY + '-user', AUTH_KEY + '-code-verifier']) await Promise.resolve(st?.removeItem(k)).catch(() => undefined);
  }
  localChanged() { this.engine?.requestPush(); }
  syncNow() { return this.engine?.syncNow(); }
  async fetchImage(id: string) { return this.engine ? this.engine.fetchImage(id) : null; }

  private temp() {
    return this.cfg.createClient(this.cfg.url, this.cfg.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'synapse-temp-' + Math.random().toString(36).slice(2) } });
  }
  // 이 기기의 열쇠(익명 사용자). 이미 있으면 재사용
  private async deviceKey(captcha: Captcha) {
    const s = (await this.sb.auth.getSession()).data.session;
    if (s && s.user.is_anonymous) return s.user.id;
    if (s) await this.dropSession();
    const { data, error } = await this.sb.auth.signInAnonymously({ options: { captchaToken: await captcha() } });
    if (error) throw error;
    return data.user!.id;
  }
  private async claim(sb: SupabaseClient, code: string, deviceName: string) {
    const { data, error } = await sb.rpc('claim_pairing', { p_code: code, p_device: deviceName });
    if (error) throw error;
    const r = data as { ok: boolean; vault_id?: string; error?: string };
    if (!r.ok) throw new SyncError(r.error || 'claim_failed', r.error);
    return r.vault_id!;
  }
  // 이 기기 열쇠로 코드를 수령한다. 남아 있던 열쇠가 다른 보관함에 묶여 있으면(오프라인에서 로그아웃해 서버에서 못 뺀 경우)
  // 그 열쇠는 버리고 새 열쇠로 한 번 더 (already_member는 코드를 소모하지 않는다).
  private async claimAsDevice(code: string, deviceName: string, captcha: Captcha) {
    await this.deviceKey(captcha);
    try { return await this.claim(this.sb, code, deviceName); } catch (e) {
      if ((e as SyncError).code !== 'already_member') throw e;
      await this.dropSession();
      await this.deviceKey(captcha);
      return this.claim(this.sb, code, deviceName);
    }
  }
  private async joined(vaultId: string, deviceName: string, firstSync: boolean, via: Meta['via']) {
    const meta: Meta = { vaultId, deviceName, firstSync, via, versions: {}, synced: {}, prefsVersion: 0, prefsHash: '', uploaded: {} };
    this.metaStore.save(meta);
    this.revokedNotice = false;
    await this.startEngine(meta);
  }

  // 설정 > 동기화 켜기: 아이디 열쇠 만들기 → 보관함 생성 → 이 기기 열쇠 연결 → 현재 데이터 업로드
  async enable(id: string, pw: string, deviceName: string, captcha: Captcha) {
    const t = this.temp();
    const { error } = await t.auth.signUp({ email: idToEmail(id), password: pw, options: { captchaToken: await captcha() } });
    if (error) throw error;
    if (!(await t.auth.getSession()).data.session) throw new SyncError('email not confirmed', 'email_not_confirmed');
    const { error: e2 } = await t.rpc('create_vault', { p_device: 'ID ' + id });
    if (e2) throw e2;
    const { data: pc, error: e3 } = await t.rpc('create_pairing');
    if (e3) throw e3;
    const vaultId = await this.claimAsDevice((pc as { code: string }).code, deviceName, captcha);
    await t.auth.signOut({ scope: 'local' });
    await this.joined(vaultId, deviceName, false, 'id');
  }

  // 새 기기: 아이디로 로그인 → (임시로) 연결 코드 발급 → 이 기기 열쇠로 수령 → 로컬 데이터와 병합
  async loginWithId(id: string, pw: string, deviceName: string, captcha: Captcha) {
    const t = this.temp();
    const { error } = await t.auth.signInWithPassword({ email: idToEmail(id), password: pw, options: { captchaToken: await captcha() } });
    if (error) throw error;
    const { data: pc, error: e2 } = await t.rpc('create_pairing');
    if (e2) throw e2;
    const vaultId = await this.claimAsDevice((pc as { code: string }).code, deviceName, captcha);
    await t.auth.signOut({ scope: 'local' });
    await this.joined(vaultId, deviceName, true, 'id');
  }

  // 새 기기: 연결 코드(또는 QR)로 연결
  async connectWithCode(code: string, deviceName: string, captcha: Captcha) {
    const vaultId = await this.claimAsDevice(code, deviceName, captcha);
    await this.joined(vaultId, deviceName, true, 'code');
  }

  // 연결된 기기에서 "다른 기기 연결"
  async createPairing(): Promise<{ code: string; expires_at: string }> {
    const { data, error } = await this.sb.rpc('create_pairing');
    if (error) throw error;
    return data as { code: string; expires_at: string };
  }

  async listMembers(): Promise<Member[]> {
    const { data, error } = await this.sb.from('vault_members').select('*').order('created_at');
    if (error) throw error;
    return (data || []) as Member[];
  }
  async myUserId() { return this.remote.userId(); }

  async removeMember(userId: string) {
    const { error } = await this.sb.rpc('remove_member', { p_user: userId });
    if (error) throw error;
  }

  // 로그아웃 준비: 대기 중인 변경을 올리고 이 기기에 없는 사진을 받아 둔 뒤, 남은 것을 알려 준다
  async prepareLogout(): Promise<{ pending: number; missingImages: number }> {
    const e = this.engine;
    if (!e) return { pending: 0, missingImages: 0 };
    // 오프라인이면 supabase-js가 토큰 갱신을 오래 재시도하므로 기다리는 시간을 제한한다 (남은 것은 경고로 보여 줌)
    const limit = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise(res => setTimeout(res, ms))]);
    await limit((async () => {
      await e.syncNow();
      if (await e.pendingCount()) await e.syncNow();   // 도는 중에 들어온 변경까지 한 번 더
    })(), 8000);
    // 사진 하나가 오래 걸려도 16초 뒤에는 "아직 이 기기에 없는 사진 수"로 답한다
    const missingImages = await Promise.race([
      e.downloadMissing(Date.now() + 15000),
      new Promise<number>(res => setTimeout(() => res(e.downloadMissing(0)), 16000)),
    ]);
    return { pending: await e.pendingCount(), missingImages };
  }
  // 로그아웃: 이 기기 열쇠를 보관함에서 빼고(기기 목록에서 사라짐) 세션을 지운다.
  // 아이디로 로그인한 기기도 이 기기에 있는 것은 기기 열쇠(익명 사용자)라서 같은 처리 — 다시 쓰려면 아이디로 로그인하면 새 열쇠가 생긴다.
  // 동기화 상태(업로드 대기·버전·사진 업로드 표시)는 지워서 다음 로그인 때 처음 연결처럼 병합한다. 로컬 맵 데이터는 그대로.
  // 서버에 닿지 않으면 이 기기만 로그아웃하고 removed=false (그 기기 줄은 다른 기기의 목록에서 해제할 수 있다).
  async logout(): Promise<{ removed: boolean }> {
    const meta = this.meta;
    this.engine?.stop();
    let removed = true;
    try {
      const me = await this.remote.userId();
      if (me) await this.removeMember(me);
    } catch (e) {
      if (/last_key/.test(String((e as Error)?.message))) { if (meta?.vaultId) void this.startEngine(meta); throw e; }
      removed = false;
    }
    await this.forgetDevice(false);
    return { removed };
  }
  async renameDevice(name: string) {
    const m = this.meta; if (!m) return;
    m.deviceName = name; this.metaStore.save(m);
    if (this.engine) this.engine.meta.deviceName = name;
    await this.remote.touch(name);
    this.emit();
  }

  // 비밀번호 변경: 지금 비밀번호로 아이디 열쇠에 잠깐 로그인해서 바꾼다
  async changePassword(id: string, oldPw: string, newPw: string, captcha: Captcha) {
    const t = this.temp();
    const { error } = await t.auth.signInWithPassword({ email: idToEmail(id), password: oldPw, options: { captchaToken: await captcha() } });
    if (error) throw error;
    const { error: e2 } = await t.auth.updateUser({ password: newPw });
    await t.auth.signOut({ scope: 'local' });
    if (e2) throw e2;
  }

  // 열쇠 재발급(비밀번호를 잊었을 때): 연결된 이 기기에서 새 아이디 열쇠를 만들어 등록하고 이전 아이디 열쇠는 제거
  async rekey(newId: string, newPw: string, captcha: Captcha) {
    const pc = await this.createPairing();
    const t = this.temp();
    const { data: su, error } = await t.auth.signUp({ email: idToEmail(newId), password: newPw, options: { captchaToken: await captcha() } });
    if (error) throw error;
    if (!(await t.auth.getSession()).data.session) throw new SyncError('email not confirmed', 'email_not_confirmed');
    await this.claim(t, pc.code, 'ID ' + newId);
    await t.auth.signOut({ scope: 'local' });
    const newUser = su.user!.id;
    for (const m of await this.listMembers()) if (m.kind === 'password' && m.user_id !== newUser) await this.removeMember(m.user_id);
  }

  // 계정 삭제: 서버의 사진 → 보관함·데이터·모든 열쇠 삭제. 기기 안 로컬 데이터는 유지.
  async deleteAccount() {
    const m = this.meta; if (!m) return;
    this.engine?.stop();
    await this.images.deleteAll(m.vaultId);
    const { error } = await this.sb.rpc('delete_vault');
    if (error) throw error;
    await this.forgetDevice(false);
  }
}

// ── 앱 전역 인스턴스 ─────────────────────────────────────────────────
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
export const syncConfigured = !!(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
let service: SyncService | null = null;
export async function loadSync(local: LocalImages): Promise<SyncService | null> {
  if (!syncConfigured) return null;
  if (!service) {
    const { createClient } = await import('@supabase/supabase-js');
    service = service || new SyncService({ url: env.VITE_SUPABASE_URL!, key: env.VITE_SUPABASE_ANON_KEY!, createClient, local });
  }
  return service;
}
// 새 기기용 QR 내용: 앱 주소 + #pair=코드 (휴대폰 기본 카메라로 찍어도 앱이 코드를 받아 연결 화면을 연다)
export const pairUrl = (code: string) => `${location.origin}${env.BASE_URL || '/'}#pair=${code}`;
export const parsePair = (s: string) => { const m = s.match(/pair=(\d{6})/) || s.match(/^\s*(\d{6})\s*$/); return m ? m[1] : null; };
// 로컬에 없는 사진을 서버에서 받기 (BoxImage·EXPORT에서 사용). 동기화가 꺼져 있으면 null.
export const fetchRemoteImage = (id: string) => (service ? service.fetchImage(id) : Promise.resolve(null));
