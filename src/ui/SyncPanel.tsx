import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { rgba } from '../lib/color';
import { type SyncService, type Member, checkId, checkPw, friendly, defaultDeviceName, pairUrl, parsePair, syncConfigured } from '../sync';
import { CaptchaWidget, TURNSTILE_SITE_KEY } from '../captcha';

type View = 'home' | 'enable' | 'login' | 'code' | 'pair' | 'password' | 'rekey' | 'delete' | 'scan';
type Props = { sync: SyncService | null; nc: string; touch: boolean; initialCode?: string | null; onCodeUsed?: () => void };

const mono = "'GalmuriMono11',monospace";
const dim = 'rgba(217,218,240,.6)';
const dash = '1px dashed rgba(217,218,240,.15)';

export default function SyncPanel({ sync, nc, touch, initialCode, onCodeUsed }: Props) {
  const [, force] = useState(0);
  const [view, setView] = useState<View>(initialCode ? 'code' : 'home');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ id: '', pw: '', pw2: '', old: '', code: initialCode || '', device: defaultDeviceName() });
  const [members, setMembers] = useState<Member[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [pair, setPair] = useState<{ code: string; exp: number; qr: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const capEl = useRef<HTMLDivElement>(null);
  const cap = useRef<CaptchaWidget | null>(null);

  useEffect(() => sync?.subscribe(() => force(x => x + 1)), [sync]);
  useEffect(() => { if (initialCode) { setView('code'); setF(x => ({ ...x, code: initialCode })); onCodeUsed?.(); } }, [initialCode, onCodeUsed]);
  const needCaptcha = view === 'enable' || view === 'login' || view === 'code' || view === 'password' || view === 'rekey';
  useEffect(() => {
    if (!needCaptcha || !capEl.current || !TURNSTILE_SITE_KEY) return;
    const w = new CaptchaWidget(capEl.current); cap.current = w;
    w.mount().catch(e => setErr(friendly(e)));
    return () => { w.unmount(); cap.current = null; };
  }, [needCaptcha, view]);
  useEffect(() => { if (!pair) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [pair]);

  const connected = !!sync?.connected;
  const loadMembers = async () => {
    if (!sync) return;
    try { setMembers(await sync.listMembers()); setMe(await sync.myUserId()); } catch (e) { setErr(friendly(e)); }
  };
  useEffect(() => { if (connected && view === 'home') loadMembers(); }, [connected, view]);

  if (!sync) {
    return <Section title="SYNC / 동기화" nc={nc}><div style={{ fontSize: 11, color: dim, lineHeight: 1.6 }}>{syncConfigured ? '불러오는 중…' : '동기화 서버가 설정되지 않았습니다. 이 기기에만 저장됩니다. (DEPLOY.md의 Supabase 설정 참고)'}</div></Section>;
  }

  const go = (v: View) => { setErr(null); setMsg(null); setF(x => ({ ...x, pw: '', pw2: '', old: '', device: x.device || sync.meta?.deviceName || defaultDeviceName() })); setView(v); };
  const captcha = () => (cap.current ? cap.current.get() : Promise.resolve(undefined));
  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); if (done) setMsg(done); } catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  };
  const device = () => (f.device.trim() || defaultDeviceName()).slice(0, 40);

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
  const back = btn('← 뒤로', () => go('home'), 'ghost');
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
      <P>아이디·비밀번호는 다른 기기를 연결할 때 쓰는 열쇠입니다. 이메일은 받지 않습니다.</P>
      {input('id', '아이디 (영문 소문자·숫자·_ 4~20자)', 'text', 'my_id')}
      {input('pw', '비밀번호 (6자 이상)', 'password')}
      {input('pw2', '비밀번호 확인', 'password')}
      {input('device', '이 기기 이름')}
      {notes}
      {btn(busy ? '만드는 중…' : '보관함 만들고 동기화 켜기', () => {
        if (!validate(checkId(f.id), checkPw(f.pw), f.pw === f.pw2 ? null : '비밀번호 확인이 다릅니다.')) return;
        run(async () => { await sync.enable(f.id, f.pw, device(), captcha); go('home'); });
      }, 'fill')}
      {back}
    </>);
  } else if (view === 'login') {
    body = (<>
      <P>이미 만든 아이디로 이 기기를 보관함에 연결합니다. 이 기기의 기존 데이터는 덮어쓰지 않고 병합합니다.</P>
      {input('id', '아이디')}
      {input('pw', '비밀번호', 'password')}
      {input('device', '이 기기 이름')}
      {notes}
      {btn(busy ? '연결 중…' : '로그인하고 연결', () => {
        if (!validate(checkId(f.id), f.pw ? null : '비밀번호를 입력하세요.')) return;
        run(async () => { await sync.loginWithId(f.id, f.pw, device(), captcha); go('home'); });
      }, 'fill')}
      {back}
    </>);
  } else if (view === 'code') {
    body = (<>
      <P>이미 연결된 기기에서 설정 → 동기화 → ‘다른 기기 연결’을 누르면 6자리 코드와 QR이 나옵니다.</P>
      {input('code', '연결 코드 (6자리)', 'text', '000000')}
      {btn('▣ QR 스캔', () => setView('scan'), 'line')}
      {input('device', '이 기기 이름')}
      {notes}
      {btn(busy ? '연결 중…' : '연결', () => {
        const c = parsePair(f.code); if (!validate(c ? null : '6자리 숫자 코드를 입력하세요.')) return;
        run(async () => { await sync.connectWithCode(c!, device(), captcha); go('home'); });
      }, 'fill')}
      {back}
    </>);
  } else if (view === 'pair') {
    const left = pair ? Math.max(0, Math.round((pair.exp - now) / 1000)) : 0;
    body = (<>
      <P>새 기기에서 ‘다른 기기로 연결’을 누르고 이 코드를 입력하거나 QR을 찍으세요. 5분 동안 한 번만 쓸 수 있습니다.</P>
      {pair && left > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: "'Galmuri11',monospace", fontSize: 30, letterSpacing: '.25em', color: '#EDEEFA', textShadow: `0 0 16px ${rgba(nc, 0.6)}`, userSelect: 'text' }}>{pair.code}</div>
          <img src={pair.qr} alt="연결 QR" style={{ width: 168, height: 168, imageRendering: 'pixelated', border: `1px solid ${rgba(nc, 0.5)}` }} />
          <div style={{ fontSize: 11, color: dim }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} 남음</div>
        </div>
      ) : <div style={{ fontSize: 11, color: dim }}>{pair ? '코드가 만료되었습니다.' : '코드를 만드는 중…'}</div>}
      {notes}
      {btn('새 코드', () => makePair(), 'line')}
      {back}
    </>);
  } else if (view === 'password') {
    const loginId = members?.find(m => m.kind === 'password')?.login_id || '';
    body = (<>
      <P>아이디 열쇠의 비밀번호를 바꿉니다. 현재 비밀번호가 필요합니다. 잊었다면 ‘열쇠 재발급’을 쓰세요.</P>
      {input('id', '아이디', 'text', loginId)}
      {input('old', '현재 비밀번호', 'password')}
      {input('pw', '새 비밀번호 (6자 이상)', 'password')}
      {input('pw2', '새 비밀번호 확인', 'password')}
      {notes}
      {btn(busy ? '바꾸는 중…' : '비밀번호 변경', () => {
        const id = f.id || loginId;
        if (!validate(checkId(id), f.old ? null : '현재 비밀번호를 입력하세요.', checkPw(f.pw), f.pw === f.pw2 ? null : '비밀번호 확인이 다릅니다.')) return;
        run(() => sync.changePassword(id, f.old, f.pw, captcha), '비밀번호를 바꿨습니다.');
      }, 'fill')}
      {back}
    </>);
  } else if (view === 'rekey') {
    body = (<>
      <P>비밀번호를 잊었을 때: 새 아이디·비밀번호를 만들어 이 보관함에 등록하고, 이전 아이디 열쇠는 제거합니다. 연결된 기기들은 그대로 유지됩니다.</P>
      {input('id', '새 아이디')}
      {input('pw', '새 비밀번호 (6자 이상)', 'password')}
      {input('pw2', '새 비밀번호 확인', 'password')}
      {notes}
      {btn(busy ? '재발급 중…' : '새 열쇠 만들기', () => {
        if (!validate(checkId(f.id), checkPw(f.pw), f.pw === f.pw2 ? null : '비밀번호 확인이 다릅니다.')) return;
        run(async () => { await sync.rekey(f.id, f.pw, captcha); await loadMembers(); }, `새 아이디 ‘${f.id}’로 바꿨습니다.`);
      }, 'fill')}
      {back}
    </>);
  } else if (view === 'delete') {
    body = (<>
      <P>보관함과 서버의 모든 맵 데이터·사진·열쇠를 지웁니다. 연결된 모든 기기의 동기화가 끊깁니다. 이 기기 안의 데이터는 그대로 남습니다. 되돌릴 수 없습니다.</P>
      {input('code', '확인을 위해 ‘삭제’를 입력하세요')}
      {notes}
      {btn(busy ? '삭제 중…' : '계정 삭제', () => {
        if (!validate(f.code.trim() === '삭제' ? null : '‘삭제’를 정확히 입력하세요.')) return;
        run(async () => { await sync.deleteAccount(); go('home'); }, '서버의 데이터를 모두 지웠습니다.');
      }, 'danger')}
      {back}
    </>);
  } else if (!connected) {
    body = (<>
      {sync.revokedNotice && <div style={{ fontSize: 11, color: '#FF9C8F', lineHeight: 1.5 }}>이 기기의 연결이 해제되었습니다. 이 기기 안의 데이터는 그대로입니다.</div>}
      <P>동기화를 켜면 맵과 사진이 내 보관함(서버)에 저장되고, 연결한 다른 기기와 맞춰집니다. 꺼 두어도 모든 기능이 그대로 동작합니다.</P>
      {btn('동기화 켜기 — 새 아이디', () => go('enable'), 'fill')}
      {btn('다른 기기로 연결 — 코드·QR', () => go('code'))}
      {btn('아이디로 로그인', () => go('login'))}
      {msg && <div style={{ fontSize: 11, color: nc }}>{msg}</div>}
    </>);
  } else {
    const st = sync.status;
    body = (<>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: st === 'OFFLINE' ? '#FF9C8F' : nc, boxShadow: `0 0 8px ${st === 'OFFLINE' ? '#FF9C8F' : nc}` }} />
        <span style={{ color: st === 'OFFLINE' ? '#FF9C8F' : nc, fontFamily: "'GalmuriMono9',monospace", letterSpacing: '.12em' }}>{st}</span>
        <span style={{ color: dim }}>{st === 'OFFLINE' ? '— 연결되면 자동으로 올립니다' : '보관함 연결됨'}</span>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: dim }}>
        이 기기 이름
        <input defaultValue={sync.meta?.deviceName} onBlur={e => { const v = e.target.value.trim(); if (v && v !== sync.meta?.deviceName) run(() => sync.renameDevice(v.slice(0, 40))); }}
          style={{ background: '#07080E', border: '1px solid rgba(217,218,240,.2)', color: '#E9EAF7', fontFamily: mono, fontSize: touch ? 16 : 12, padding: '7px 8px', borderRadius: 0, userSelect: 'text', WebkitUserSelect: 'text' }} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {btn('다른 기기 연결', () => { go('pair'); makePair(); }, 'fill')}
        {btn('지금 동기화', () => { sync.syncNow(); loadMembers(); })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: dash, paddingTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: dim }}><span>연결된 열쇠</span><span>{members ? members.length : '…'}</span></div>
        {members?.map(m => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid rgba(217,218,240,.12)', fontSize: 11 }}>
            <span style={{ width: 6, height: 6, flex: 'none', background: m.kind === 'password' ? 'transparent' : nc, border: m.kind === 'password' ? `1px solid ${nc}` : 'none' }} />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: '#E9EAF7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.kind === 'password' ? `아이디 열쇠 · ${m.login_id}` : m.device_name || '이름 없는 기기'}{m.user_id === me ? ' (이 기기)' : ''}
              </span>
              <span style={{ color: 'rgba(217,218,240,.45)', fontSize: 10 }}>{m.kind === 'password' ? '새 기기 연결용' : '마지막 접속 ' + ago(m.last_seen_at)}</span>
            </span>
            {m.user_id !== me && m.kind === 'device' && (
              <span onClick={() => { if (window.confirm(`‘${m.device_name}’ 기기의 연결을 해제할까요? 그 기기는 더 이상 서버 데이터에 접근할 수 없습니다.`)) run(async () => { await sync.removeMember(m.user_id); await loadMembers(); }, '연결을 해제했습니다.'); }}
                style={{ cursor: 'pointer', color: '#FF9C8F', flex: 'none', padding: '2px 4px' }}>해제</span>
            )}
          </div>
        ))}
      </div>
      {notes}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, borderTop: dash, paddingTop: 12 }}>
        {btn('비밀번호 변경', () => go('password'), 'ghost')}
        {btn('열쇠 재발급', () => go('rekey'), 'ghost')}
        {btn('이 기기 연결 해제', () => { if (window.confirm('이 기기의 동기화를 끊을까요? 이 기기 안의 데이터는 그대로 남습니다.')) run(() => sync.disconnectThisDevice()); }, 'ghost')}
        {btn('계정 삭제', () => { go('delete'); setF(x => ({ ...x, code: '' })); }, 'danger')}
      </div>
    </>);
  }

  async function makePair() {
    setErr(null);
    try {
      const p = await sync!.createPairing();
      const qr = await QRCode.toDataURL(pairUrl(p.code), { margin: 1, scale: 4, color: { dark: '#05060B', light: '#E9EAF7' } });
      setPair({ code: p.code, exp: new Date(p.expires_at).getTime(), qr }); setNow(Date.now());
    } catch (e) { setErr(friendly(e)); }
  }

  return (
    <Section title="SYNC / 동기화" nc={nc}>
      {body}
      <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'rgba(217,218,240,.45)', alignSelf: 'flex-start' }}>개인정보처리방침</a>
    </Section>
  );
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return '방금';
  if (s < 3600) return Math.round(s / 60) + '분 전';
  if (s < 86400) return Math.round(s / 3600) + '시간 전';
  return Math.round(s / 86400) + '일 전';
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
      } catch { setErr('카메라를 쓸 수 없습니다. 코드를 직접 입력하세요.'); }
    })();
    return () => { live = false; clearInterval(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, []);
  return (
    <>
      <video ref={video} playsInline muted style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', background: '#000', border: `1px solid ${rgba(nc, 0.5)}` }} />
      {err && <div style={{ fontSize: 11, color: '#FF9C8F' }}>{err}</div>}
      <button onClick={onCancel} style={{ height: 34, background: 'transparent', color: dim, border: '1px solid rgba(217,218,240,.2)', fontFamily: mono, fontSize: 12, cursor: 'pointer' }}>← 코드 입력으로</button>
    </>
  );
}
