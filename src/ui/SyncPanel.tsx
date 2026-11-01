import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { rgba } from '../lib/color';
import { type SyncService, type Member, checkId, checkPw, friendly, isRateLimited, defaultDeviceName, pairUrl, parsePair, syncConfigured } from '../sync';
import { CaptchaWidget, TURNSTILE_SITE_KEY } from '../captcha';
import { listLocalBackups } from '../storage';
import { alive } from '../model';
import { t, dual, getLang, subscribeLang, fmtDateTime, fmtAgo, SITE_PATH } from '../i18n';

type View = 'home' | 'enable' | 'login' | 'code' | 'pair' | 'password' | 'rekey' | 'delete' | 'scan' | 'logout';
type Props = {
  sync: SyncService | null; nc: string; touch: boolean; initialCode?: string | null; onCodeUsed?: () => void; onWipeLocal?: () => Promise<void>;
  onRestoreBackup?: (id: string) => Promise<number>;
};
type BackupRow = { id: string; at: number; boxes: number };

const mono = "'GalmuriMono11',monospace";
const dim = 'rgba(217,218,240,.6)';
const dash = '1px dashed rgba(217,218,240,.15)';

export default function SyncPanel({ sync, nc, touch, initialCode, onCodeUsed, onWipeLocal, onRestoreBackup }: Props) {
  const [, force] = useState(0);
  useSyncExternalStore(subscribeLang, getLang);   // 언어를 바꾸면 다시 그린다
  const [view, setView] = useState<View>(initialCode ? 'code' : 'home');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ id: '', pw: '', pw2: '', old: '', code: initialCode || '', device: defaultDeviceName() });
  const [members, setMembers] = useState<Member[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [pair, setPair] = useState<{ code: string; exp: number; qr: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lockUntil, setLockUntil] = useState(0);   // 429를 받으면 30초 동안 가입·로그인 버튼 잠금
  const busyRef = useRef(false);                    // 같은 프레임 안의 두 번 클릭도 막는다
  const [lo, setLo] = useState<{ pending: number; missingImages: number; wipe: boolean } | null>(null);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const capEl = useRef<HTMLDivElement>(null);
  const cap = useRef<CaptchaWidget | null>(null);

  useEffect(() => sync?.subscribe(() => force(x => x + 1)), [sync]);
  // 이전 기기 데이터(계정 내용만 불러오기 전에 남긴 백업). 상태가 바뀔 때마다 다시 읽는다 (방금 만든 백업 포함)
  const loadBackups = () => listLocalBackups().then(
    l => setBackups(l.map(b => ({ id: b.id, at: b.at, boxes: b.data.cats.filter(alive).reduce((n, c) => n + c.boxes.filter(alive).length, 0) }))),
    () => setBackups([]),
  );
  useEffect(() => { loadBackups(); }, [sync?.status]);
  useEffect(() => { if (initialCode) { setView('code'); setF(x => ({ ...x, code: initialCode })); onCodeUsed?.(); } }, [initialCode, onCodeUsed]);
  const needCaptcha = view === 'enable' || view === 'login' || view === 'code' || view === 'password' || view === 'rekey';
  useEffect(() => {
    if (!needCaptcha || !capEl.current || !TURNSTILE_SITE_KEY) return;
    const w = new CaptchaWidget(capEl.current); cap.current = w;
    w.mount().catch(e => setErr(friendly(e)));
    return () => { w.unmount(); cap.current = null; };
  }, [needCaptcha, view]);
  useEffect(() => { if (!pair) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [pair]);
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const t = setInterval(() => { setNow(Date.now()); if (Date.now() >= lockUntil) clearInterval(t); }, 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  const connected = !!sync?.connected;
  const loadMembers = async () => {
    if (!sync) return;
    try { setMembers(await sync.listMembers()); setMe(await sync.myUserId()); } catch (e) { setErr(friendly(e)); }
  };
  useEffect(() => { if (connected && view === 'home') loadMembers(); }, [connected, view]);

  if (!sync) {
    return <Section title={dual('SYNC', t('head.sync'))} nc={nc}><div style={{ fontSize: 11, color: dim, lineHeight: 1.6 }}>{syncConfigured ? t('sync.loading') : t('sync.notConfigured')}</div></Section>;
  }

  const go = (v: View) => { setErr(null); setMsg(null); setF(x => ({ ...x, pw: '', pw2: '', old: '', device: x.device || sync.meta?.deviceName || defaultDeviceName() })); setView(v); };
  const captcha = () => (cap.current ? cap.current.get() : Promise.resolve(undefined));
  // 요청은 한 번만 보낸다(실패해도 자동 재시도 없음). 도는 동안 버튼은 비활성.
  const run = async (fn: () => Promise<void>, done?: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (done) setMsg(done); } catch (e) {
      setErr(friendly(e));
      if (isRateLimited(e)) { setLockUntil(Date.now() + 30000); setNow(Date.now()); }
    } finally { busyRef.current = false; setBusy(false); }
  };
  const lockLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000));
  // 가입·로그인처럼 서버 인증을 쓰는 버튼: 429 뒤에는 남은 초를 보여 주며 잠근다
  const authBtn = (label: string, onClick: () => void) => btn(lockLeft > 0 ? t('sync.retryIn', { n: lockLeft }) : label, onClick, 'fill', lockLeft > 0);
  const device = () => (f.device.trim() || defaultDeviceName()).slice(0, 40);
  const deleteWord = t('sync.deleteWord');   // 계정 삭제 확인에 입력할 낱말 (언어별)

  const input = (key: keyof typeof f, label: string, type = 'text', ph = '') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: dim }}>
      {label}
      <input type={type} value={f[key]} placeholder={ph} autoComplete={type === 'password' ? (key === 'old' || view === 'login' ? 'current-password' : 'new-password') : key === 'id' ? 'username' : 'off'}
        autoCapitalize="none" spellCheck={false} inputMode={key === 'code' ? 'numeric' : undefined}
        onChange={e => setF(x => ({ ...x, [key]: key === 'id' ? e.target.value.toLowerCase() : e.target.value }))}
        style={{ background: '#07080E', border: '1px solid rgba(217,218,240,.2)', color: '#E9EAF7', fontFamily: mono, fontSize: touch ? 16 : 12, padding: '7px 8px', borderRadius: 0, width: '100%', boxSizing: 'border-box', userSelect: 'text', WebkitUserSelect: 'text', letterSpacing: key === 'code' ? '.3em' : undefined }} />
    </label>
  );
  const btn = (label: string, onClick: () => void, kind: 'fill' | 'line' | 'danger' | 'ghost' = 'line', disabled = false) => (
    <button disabled={disabled || busy} onClick={onClick} style={{
      height: 34, padding: '0 10px', cursor: disabled || busy ? 'default' : 'pointer', fontFamily: mono, fontSize: 12, opacity: disabled || busy ? 0.5 : 1, width: '100%',
      background: kind === 'fill' ? nc : 'transparent', color: kind === 'fill' ? '#05060B' : kind === 'danger' ? '#FF9C8F' : kind === 'ghost' ? dim : nc,
      border: kind === 'fill' ? 'none' : kind === 'danger' ? '1px solid rgba(255,156,143,.5)' : kind === 'ghost' ? '1px solid rgba(217,218,240,.2)' : `1px solid ${nc}`,
    }}>{label}</button>
  );
  const back = btn(t('sync.back'), () => go('home'), 'ghost');
  const notes = (
    <>
      {needCaptcha && TURNSTILE_SITE_KEY && <div ref={capEl} style={{ minHeight: 0 }} />}
      {err && <div style={{ fontSize: 11, color: '#FF9C8F', lineHeight: 1.5 }}>{err}</div>}
      {msg && <div style={{ fontSize: 11, color: nc, lineHeight: 1.5 }}>{msg}</div>}
    </>
  );
  const validate = (...checks: (string | null)[]) => { const e = checks.find(Boolean); if (e) { setErr(e); return false; } return true; };

  let body: ReactNode;
  if (view === 'scan') {
    body = <Scanner nc={nc} onCode={c => { setF(x => ({ ...x, code: c })); setView('code'); }} onCancel={() => setView('code')} />;
  } else if (view === 'enable') {
    body = (<>
      <P>{t('sync.enableIntro')}</P>
      {input('id', t('sync.idRule'), 'text', 'my_id')}
      {input('pw', t('sync.passwordRule'), 'password')}
      {input('pw2', t('sync.passwordConfirm'), 'password')}
      {input('device', t('sync.deviceName'))}
      {notes}
      {authBtn(busy ? t('sync.creating') : t('sync.enable'), () => {
        if (!validate(checkId(f.id), checkPw(f.pw), f.pw === f.pw2 ? null : t('sync.pwMismatch'))) return;
        run(async () => { await sync.enable(f.id, f.pw, device(), captcha); go('home'); });
      })}
      {back}
    </>);
  } else if (view === 'login') {
    body = (<>
      <P>{t('sync.loginIntro')}</P>
      {input('id', t('sync.id'))}
      {input('pw', t('sync.password'), 'password')}
      {input('device', t('sync.deviceName'))}
      {notes}
      {authBtn(busy ? t('sync.connecting') : t('sync.login'), () => {
        if (!validate(checkId(f.id), f.pw ? null : t('sync.enterPassword'))) return;
        run(async () => { await sync.loginWithId(f.id, f.pw, device(), captcha); go('home'); });
      })}
      {back}
    </>);
  } else if (view === 'code') {
    body = (<>
      <P>{t('sync.codeIntro')}</P>
      {input('code', t('sync.code'), 'text', '000000')}
      {btn(t('sync.scanQr'), () => setView('scan'), 'line')}
      {input('device', t('sync.deviceName'))}
      {notes}
      {authBtn(busy ? t('sync.connecting') : t('sync.connect'), () => {
        const c = parsePair(f.code); if (!validate(c ? null : t('sync.enterCode'))) return;
        run(async () => { await sync.connectWithCode(c!, device(), captcha); go('home'); });
      })}
      {back}
    </>);
  } else if (view === 'pair') {
    const left = pair ? Math.max(0, Math.round((pair.exp - now) / 1000)) : 0;
    body = (<>
      <P>{t('sync.pairIntro')}</P>
      {pair && left > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: "'Galmuri11',monospace", fontSize: 30, letterSpacing: '.25em', color: '#EDEEFA', textShadow: `0 0 16px ${rgba(nc, 0.6)}`, userSelect: 'text' }}>{pair.code}</div>
          <img src={pair.qr} alt={t('sync.pairQrAlt')} style={{ width: 168, height: 168, imageRendering: 'pixelated', border: `1px solid ${rgba(nc, 0.5)}` }} />
          <div style={{ fontSize: 11, color: dim }}>{t('sync.timeLeft', { time: Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') })}</div>
        </div>
      ) : <div style={{ fontSize: 11, color: dim }}>{pair ? t('sync.codeExpired') : t('sync.codeMaking')}</div>}
      {notes}
      {btn(t('sync.newCode'), () => makePair(), 'line')}
      {back}
    </>);
  } else if (view === 'password') {
    const loginId = members?.find(m => m.kind === 'password')?.login_id || '';
    body = (<>
      <P>{t('sync.passwordIntro')}</P>
      {input('id', t('sync.id'), 'text', loginId)}
      {input('old', t('sync.currentPassword'), 'password')}
      {input('pw', t('sync.newPasswordRule'), 'password')}
      {input('pw2', t('sync.newPasswordConfirm'), 'password')}
      {notes}
      {authBtn(busy ? t('sync.changing') : t('sync.changePassword'), () => {
        const id = f.id || loginId;
        if (!validate(checkId(id), f.old ? null : t('sync.enterCurrent'), checkPw(f.pw), f.pw === f.pw2 ? null : t('sync.pwMismatch'))) return;
        run(() => sync.changePassword(id, f.old, f.pw, captcha), t('sync.passwordChanged'));
      })}
      {back}
    </>);
  } else if (view === 'rekey') {
    body = (<>
      <P>{t('sync.rekeyIntro')}</P>
      {input('id', t('sync.newId'))}
      {input('pw', t('sync.newPasswordRule'), 'password')}
      {input('pw2', t('sync.newPasswordConfirm'), 'password')}
      {notes}
      {authBtn(busy ? t('sync.rekeying') : t('sync.rekey'), () => {
        if (!validate(checkId(f.id), checkPw(f.pw), f.pw === f.pw2 ? null : t('sync.pwMismatch'))) return;
        run(async () => { await sync.rekey(f.id, f.pw, captcha); await loadMembers(); }, t('sync.rekeyed', { id: f.id }));
      })}
      {back}
    </>);
  } else if (view === 'logout') {
    const via = sync.meta?.via;
    const option = (wipe: boolean, title: string, desc: string) => (
      <div role="radio" aria-checked={lo?.wipe === wipe} onClick={() => setLo(x => (x ? { ...x, wipe } : x))}
        style={{ display: 'flex', gap: 8, padding: '8px 9px', cursor: 'pointer', border: `1px solid ${lo?.wipe === wipe ? (wipe ? 'rgba(255,156,143,.6)' : nc) : 'rgba(217,218,240,.15)'}`, fontSize: 11 }}>
        <span style={{ color: lo?.wipe === wipe ? (wipe ? '#FF9C8F' : nc) : dim, flex: 'none' }}>{lo?.wipe === wipe ? '◉' : '○'}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: wipe ? '#FF9C8F' : '#E9EAF7' }}>{title}</span>
          <span style={{ color: 'rgba(217,218,240,.5)', fontSize: 10, lineHeight: 1.5 }}>{desc}</span>
        </span>
      </div>
    );
    body = !lo ? (<>
      <P>{t('sync.flushing')}</P>
      {notes}
      {back}
    </>) : (<>
      {lo.pending > 0 && <div style={{ fontSize: 11, color: '#FF9C8F', lineHeight: 1.6 }}>{t('sync.pendingWarn')}</div>}
      {lo.missingImages > 0 && <div style={{ fontSize: 11, color: '#FF9C8F', lineHeight: 1.6 }}>{t('sync.missingImages', { n: lo.missingImages })}</div>}
      {option(false, t('sync.keepLocal'), t('sync.keepLocalDesc'))}
      {option(true, t('sync.wipeLocal'), t('sync.wipeLocalDesc'))}
      <P>{t('sync.leaveList')} {t(via === 'code' ? 'sync.reconnectCode' : via === 'id' ? 'sync.reconnectId' : 'sync.reconnectAny')}</P>
      {notes}
      {btn(busy ? t('sync.loggingOut') : lo.wipe ? t('sync.logoutWipe') : t('sync.logout'), () => {
        const wipe = lo.wipe;
        run(async () => {
          const r = await sync.logout();
          if (wipe && onWipeLocal) { await onWipeLocal(); return; }
          go('home');
          setMsg(t(r.removed ? 'sync.loggedOut' : 'sync.loggedOutOffline'));
        });
      }, lo.wipe ? 'danger' : 'fill')}
      {lo.pending > 0 && btn(t('sync.retryUpload'), () => startLogout(), 'line')}
      {back}
    </>);
  } else if (view === 'delete') {
    body = (<>
      <P>{t('sync.deleteIntro')}</P>
      {input('code', t('sync.deleteConfirm', { word: deleteWord }))}
      {notes}
      {btn(busy ? t('sync.deleting') : t('sync.deleteAccount'), () => {
        if (!validate(f.code.trim().toLowerCase() === deleteWord.toLowerCase() ? null : t('sync.deleteMismatch', { word: deleteWord }))) return;
        run(async () => { await sync.deleteAccount(); go('home'); }, t('sync.deleted'));
      }, 'danger')}
      {back}
    </>);
  } else if (!connected) {
    body = (<>
      {sync.revokedNotice && <div style={{ fontSize: 11, color: '#FF9C8F', lineHeight: 1.5 }}>{t('sync.revoked')}</div>}
      <P>{t('sync.offIntro')}</P>
      {btn(t('sync.enableNew'), () => go('enable'), 'fill')}
      {btn(t('sync.connectOther'), () => go('code'))}
      {btn(t('sync.loginWithId'), () => go('login'))}
      {msg && <div style={{ fontSize: 11, color: nc }}>{msg}</div>}
    </>);
  } else {
    const st = sync.status;
    body = (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st === 'OFFLINE' ? '#FF9C8F' : nc, boxShadow: `0 0 8px ${st === 'OFFLINE' ? '#FF9C8F' : nc}` }} />
        <span style={{ color: st === 'OFFLINE' ? '#FF9C8F' : nc, fontFamily: "'GalmuriMono9',monospace", letterSpacing: '.12em' }}>{st}</span>
        <span style={{ color: dim }}>{t(st === 'OFFLINE' ? 'sync.offlineNote' : st === 'WAITING' ? 'sync.waitingNote' : 'sync.connected')}</span>
      </div>
      {st === 'WAITING' && (<>
        <P>{t('sync.waitingIntro')}</P>
        {btn(t('sync.choose'), () => sync.reopenJoin(), 'fill')}
      </>)}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: dim }}>
        {t('sync.deviceName')}
        <input defaultValue={sync.meta?.deviceName} onBlur={e => { const v = e.target.value.trim(); if (v && v !== sync.meta?.deviceName) run(() => sync.renameDevice(v.slice(0, 40))); }}
          style={{ background: '#07080E', border: '1px solid rgba(217,218,240,.2)', color: '#E9EAF7', fontFamily: mono, fontSize: touch ? 16 : 12, padding: '7px 8px', borderRadius: 0, userSelect: 'text', WebkitUserSelect: 'text' }} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {btn(t('sync.pair'), () => { go('pair'); makePair(); }, 'fill')}
        {btn(t('sync.syncNow'), () => { sync.syncNow(); loadMembers(); })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: dash, paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: dim }}><span>{t('sync.keys')}</span><span>{members ? members.length : '…'}</span></div>
        {members?.map(m => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid rgba(217,218,240,.12)', fontSize: 11 }}>
            <span style={{ width: 6, height: 6, flex: 'none', background: m.kind === 'password' ? 'transparent' : nc, border: m.kind === 'password' ? `1px solid ${nc}` : 'none' }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: '#E9EAF7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.kind === 'password' ? t('sync.idKey', { id: m.login_id || '' }) : m.device_name || t('sync.unnamedDevice')}{m.user_id === me ? t('sync.thisDevice') : ''}
              </span>
              <span style={{ color: 'rgba(217,218,240,.45)', fontSize: 10 }}>{m.kind === 'password' ? t('sync.forNewDevices') : t('sync.lastSeen', { when: fmtAgo(m.last_seen_at) })}</span>
            </span>
            {m.user_id !== me && m.kind === 'device' && (
              <span onClick={() => { if (window.confirm(t('sync.removeConfirm', { name: m.device_name || t('sync.unnamedDevice') }))) run(async () => { await sync.removeMember(m.user_id); await loadMembers(); }, t('sync.removed')); }}
                style={{ cursor: 'pointer', color: '#FF9C8F', flex: 'none', padding: '2px 4px' }}>{t('sync.remove')}</span>
            )}
          </div>
        ))}
      </div>
      {notes}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, borderTop: dash, paddingTop: 12 }}>
        {btn(t('sync.changePassword'), () => go('password'), 'ghost')}
        {btn(t('sync.rekeyBtn'), () => go('rekey'), 'ghost')}
        {btn(t('sync.logout'), () => startLogout(), 'ghost')}
        {btn(t('sync.deleteAccount'), () => { go('delete'); setF(x => ({ ...x, code: '' })); }, 'danger')}
      </div>
    </>);
  }

  function startLogout() {
    go('logout'); setLo(null);
    // 확인이 실패해도 로그아웃은 할 수 있게: 이때는 올라가지 않은 변경이 있다고 가정하고 경고를 띄운다
    run(async () => { try { setLo({ ...(await sync!.prepareLogout()), wipe: false }); } catch { setLo({ pending: 1, missingImages: 0, wipe: false }); } });
  }

  async function makePair() {
    setErr(null);
    try {
      const p = await sync!.createPairing();
      const qr = await QRCode.toDataURL(pairUrl(p.code), { margin: 1, scale: 4, color: { dark: '#05060B', light: '#E9EAF7' } });
      setPair({ code: p.code, exp: new Date(p.expires_at).getTime(), qr }); setNow(Date.now());
    } catch (e) { setErr(friendly(e)); }
  }

  const restore = (b: BackupRow) => run(async () => {
    const n = await onRestoreBackup!(b.id);
    await loadBackups();
    setMsg(n ? t('toast.addedBoxes', { n }) : t('toast.nothingToAdd'));
  });
  const recover = view === 'home' && backups.length > 0 && onRestoreBackup && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: dash, paddingTop: 12 }}>
      <div style={{ fontSize: 11, color: dim }}>{t('sync.restoreTitle')}</div>
      <P>{t('sync.restoreIntro')}</P>
      {backups.map(b => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid rgba(217,218,240,.12)', fontSize: 11 }}>
          <span style={{ flex: 1, minWidth: 0, color: '#E9EAF7' }}>{fmtDateTime(b.at)}<span style={{ color: 'rgba(217,218,240,.45)' }}> · {t('sync.backupBoxes', { n: b.boxes })}</span></span>
          <span onClick={() => { if (!busy) restore(b); }} style={{ cursor: busy ? 'default' : 'pointer', color: nc, flex: 'none', padding: '2px 4px' }}>{t('sync.add')}</span>
        </div>
      ))}
    </div>
  );

  return (
    <Section title={dual('SYNC', t('head.sync'))} nc={nc}>
      {body}
      {recover}
      <a href={`${import.meta.env.BASE_URL}${SITE_PATH[getLang()]}privacy.html`} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'rgba(217,218,240,.45)', alignSelf: 'flex-start' }}>{t('sync.privacy')}</a>
    </Section>
  );
}

function P({ children }: { children: ReactNode }) { return <div style={{ fontSize: 11, color: dim, lineHeight: 1.6 }}>{children}</div>; }

function Section({ title, nc, children }: { title: string; nc: string; children: ReactNode }) {
  const st: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, borderTop: dash, paddingTop: 14 };
  return (
    <div style={st}>
      <div style={{ fontSize: 11, letterSpacing: '.16em', color: nc }}>{title}</div>
      {children}
    </div>
  );
}

// 카메라로 QR 읽기 (iOS Safari 포함 — BarcodeDetector 대신 jsQR)
function Scanner({ nc, onCode, onCancel }: { nc: string; onCode: (c: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onCode); cb.current = onCode;
  useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, live = true;
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d', { willReadFrequently: true })!;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (!live || !video.current) return;
        video.current.srcObject = stream; await video.current.play();
        timer = window.setInterval(() => {
          const v = video.current; if (!v || !v.videoWidth) return;
          cv.width = v.videoWidth; cv.height = v.videoHeight; ctx.drawImage(v, 0, 0);
          const r = jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
          const c = r && parsePair(r.data);
          if (c) { live = false; clearInterval(timer); cb.current(c); }
        }, 250);
      } catch { setErr(t('sync.camera')); }
    })();
    return () => { live = false; clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return (
    <>
      <video ref={video} playsInline muted style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', background: '#000', border: `1px solid ${rgba(nc, 0.5)}` }} />
      {err && <div style={{ fontSize: 11, color: '#FF9C8F' }}>{err}</div>}
      <button onClick={onCancel} style={{ height: 34, background: 'transparent', color: dim, border: '1px solid rgba(217,218,240,.2)', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}>{t('sync.backToCode')}</button>
    </>
  );
}
