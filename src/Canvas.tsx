import React from 'react';
import { flushSync } from 'react-dom';
import { PALETTE, PENS, rgba, colorName } from './lib/color';
import { md } from './lib/md';
import { route, ports, curve, dendrite, smooth, roundPath, type Pt } from './lib/geometry';
import {
  type Data, type Category, type Box, type Prefs, type PrefsT, type View, type Persisted,
  tick, uid, alive, visibleCats, liveBoxes, liveLinks, liveStrokes, stampChanges, applyTarget, clockValue, clearCategory,
} from './model';
import { saveAll, putImage, getImage, requestPersist, resetAll, saveLocalBackup, getLocalBackup, restoreBackupImages } from './storage';
import { loadSync, parsePair, type SyncService, type SyncStatus } from './sync';
import { mergeData, mergePrefs, rebaseSnapshot } from './merge';
import { addToAccount, type JoinPlan, type JoinResult } from './join';
// 동기화 화면(QR 생성·스캔 포함)은 설정을 열 때 불러온다
const SyncPanel = React.lazy(() => import('./ui/SyncPanel'));
const Licenses = React.lazy(() => import('./ui/Licenses'));
import { exportBackup, validateBackup, materializeBackup } from './backup';
import { BoxImage } from './ui/BoxImage';
import { HELP_DESKTOP, HELP_TOUCH } from './ui/help';
import { mouseAction, type Tool } from './lib/input';

// ── 디자인 상수 (dc.html) ─────────────────────────────
const K = 0.85;              // 전역 85% 스케일
const EDGE_STYLE: 'neuron' | 'circuit' = 'neuron';  // dc.html의 편집용 prop. 기본값 고정
const CORNER: 'sharp' | 'soft' = 'sharp';
const SHOW_GRID = true;
const MOBILE = 640;          // 이 폭 미만은 하단 툴바 + 하단 시트
const EDGE_ZONE = 24;        // 터치 가장자리 스와이프 영역(px)
const EDGE_SWIPE = 90;       // 가장자리 스와이프 전환 거리
const MOUSE_SWIPE = 120;     // 우클릭 드래그 전환 거리 (진행 바가 가득 차는 값이기도 함)
const WHEEL_SWIPE = 260;     // Space + 두 손가락 스와이프 전환 누적값
const CLICK_SLOP = 3;        // 이보다 적게 움직이면 클릭(선택 해제), 넘으면 화면 이동
const LONG_PRESS = 480;
const DOUBLE_TAP = 320;

type Drag =
  | { type: 'pan'; id: number; sx: number; sy: number; ox: number; oy: number; tap?: boolean; click?: boolean; shift?: boolean; moved?: boolean }
  | { type: 'draw'; id: number }
  | { type: 'swipe'; id: number; sx: number; sy: number; dx?: number; dy?: number }
  | { type: 'edge'; id: number; sx: number; sy: number; dx?: number; dy?: number }
  | { type: 'move'; id: number; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; pushed?: boolean }
  | { type: 'resize'; id: number; sx: number; sy: number; box: string; ow: number; oh: number; pushed?: boolean }
  | { type: 'boxTouch'; id: number; sx: number; sy: number; box: string; part: 'body' | 'handle'; consumed?: boolean; scrollEl?: HTMLElement | null; ly?: number };

type State = {
  data: Data; prefs: Prefs; prefsT: PrefsT; views: Record<string, View>; active: string;
  tool: Tool; sel: string[]; editing: string | null; hover: string | null; connectFrom: string | null; mouseW: Pt | null;
  settingsOpen: boolean; helpOpen: boolean; licensesOpen: boolean; clearOpen: boolean; renaming: string | null; saveStatus: string; saveErr: boolean;
  swipe: number; liveStroke: [number, number][] | null; space: boolean; flash: { name: string; idx: number } | null; flashOn: boolean;
  panning: boolean; dragging: boolean; vw: number; vh: number; kb: number; touchMode: boolean; sheetOpen: boolean;
  iosHint: boolean; wco: boolean; syncStatus: SyncStatus; pairCode: string | null;
  joinAsk: JoinPlan | null; joinStep: 'ask' | 'confirm'; joinBusy: boolean; joinErr: string | null; toast: string | null;
};

const hhmm = () => { const t = new Date(); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
const textW = (s: string) => { let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 0x1100 ? 1 : 0.62; return Math.max(3, w + 0.8) + 'em'; };
const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => mq('(display-mode: standalone)') || (navigator as unknown as { standalone?: boolean }).standalone === true;
const IOS_HINT_KEY = 'synapse-ios-hint-dismissed';
type WCO = { visible: boolean; addEventListener: (t: string, f: () => void) => void };
const wcoApi = () => (navigator as unknown as { windowControlsOverlay?: WCO }).windowControlsOverlay;

export default class Canvas extends React.Component<{ initial: Persisted; fresh: boolean }, State> {
  hist: Data[] = [];
  noiseRef = React.createRef<HTMLCanvasElement>();
  fileRef = React.createRef<HTMLInputElement>();
  importRef = React.createRef<HTMLInputElement>();
  mdCache = new Map<string, string>();
  routeCache = new Map<string, Pt[] | null>();
  drag: Drag | null = null;
  touches = new Map<number, { x: number; y: number }>();
  pinch: { d0: number; z0: number; wx: number; wy: number } | null = null;
  ignoreTouches = false;
  lastTap: { t: number; x: number; y: number; target: string } | null = null;
  lastTabTap: { t: number; id: string } | null = null;
  longT = 0;
  penSeen = false;
  lastPT = 'mouse';
  userMoved = false;
  focusEdit = false;
  focusRename = false;
  saveT = 0; flashT = 0; toastT = 0; noiseTimer = 0; wT = 0; wAcc = 0; wCool = 0; swipeEndAt = 0;
  dragTab: string | null = null;
  sizeNoise: (() => void) | null = null;
  off: (() => void)[] = [];
  sync: SyncService | null = null;

  constructor(p: { initial: Persisted; fresh: boolean }) {
    super(p);
    const i = p.initial;
    let hintDismissed = false;
    try { hintDismissed = localStorage.getItem(IOS_HINT_KEY) === '1'; } catch { /* 저장 불가 환경 */ }
    this.state = {
      data: i.data, prefs: i.prefs, prefsT: i.prefsT, views: i.views, active: i.active,
      tool: 'select', sel: [], editing: null, hover: null, connectFrom: null, mouseW: null,
      settingsOpen: false, helpOpen: false, licensesOpen: false, clearOpen: false, renaming: null, saveStatus: 'SAVED ' + hhmm(), saveErr: false,
      swipe: 0, liveStroke: null, space: false, flash: null, flashOn: false, panning: false, dragging: false,
      vw: window.innerWidth, vh: window.innerHeight, kb: 0, touchMode: mq('(pointer: coarse)'), sheetOpen: false,
      iosHint: isIOS() && !isStandalone() && !hintDismissed, wco: !!wcoApi()?.visible,
      syncStatus: 'off', pairCode: null,
      joinAsk: null, joinStep: 'ask', joinBusy: false, joinErr: null, toast: null,
    };
  }

  // ── 조회 ────────────────────────────────────────────
  get cats() { return visibleCats(this.state.data); }
  get cat(): Category { const cs = this.cats; return cs.find(c => c.id === this.state.active) || cs[0]; }
  get mobile() { return this.state.vw < MOBILE; }
  view(): View { const v = this.state.views[this.cat.id]; return v || { x: window.innerWidth / 2, y: window.innerHeight / 2, z: 1 }; }
  toWorld(cx: number, cy: number) { const v = this.view(), z = v.z * K; return { x: (cx - v.x) / z, y: (cy - v.y) / z }; }

  // ── 생명주기 ─────────────────────────────────────────
  componentDidMount() {
    const on = <K2 extends keyof WindowEventMap>(t: K2, f: (e: WindowEventMap[K2]) => void, o?: AddEventListenerOptions) => {
      window.addEventListener(t, f, o); this.off.push(() => window.removeEventListener(t, f, o));
    };
    on('pointerdown', e => this.onAnyDown(e), { capture: true });
    on('pointermove', e => this.onMove(e));
    on('pointerup', e => this.onUp(e));
    on('pointercancel', e => this.onUp(e, true));
    on('keydown', e => this.onKey(e));
    on('keyup', e => {
      if (e.code !== 'Space') return;
      const tag = (e.target as Element).tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault();   // 포커스된 버튼이 눌리는 등 기본 동작 막기
      this.wAcc = 0; this.setState({ space: false, swipe: 0 });
    });
    on('blur', () => { if (this.state.space) this.setState({ space: false, swipe: 0 }); });
    on('wheel', e => this.onWheel(e), { passive: false });
    on('resize', () => { this.sizeNoise?.(); this.setState({ vw: window.innerWidth, vh: window.innerHeight }); if (!this.userMoved) this.fit(); });
    // Safari 페이지 핀치 확대 막기 (캔버스 핀치는 직접 처리)
    const gs = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', gs); this.off.push(() => document.removeEventListener('gesturestart', gs));
    const vis = () => { if (document.visibilityState === 'hidden') this.flushSave(); };
    document.addEventListener('visibilitychange', vis); this.off.push(() => document.removeEventListener('visibilitychange', vis));
    const vv = window.visualViewport;
    if (vv) {
      const f = () => this.onViewport(); vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
      this.off.push(() => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); });
    }
    const w = wcoApi();
    if (w) w.addEventListener('geometrychange', () => this.setState({ wco: !!w.visible }));
    this.startNoise();
    this.startSync();
    const tryFit = () => { if (window.innerWidth > 0 && !this.userMoved) this.fit(); };
    [0, 120, 400, 1000].forEach(t => setTimeout(tryFit, t));
    requestPersist();
  }
  // ── 동기화 (선택) ───────────────────────────────────
  startSync() {
    // QR을 기본 카메라로 찍어 열린 경우: #pair=123456 → 설정의 연결 화면을 연다
    const code = parsePair(location.hash);
    if (code) { this.setState({ pairCode: code, settingsOpen: true }); history.replaceState(null, '', location.pathname + location.search); }
    loadSync({ get: getImage, put: async (id, b) => { await putImage(id, b); } }).then(sync => { if (sync) this.attachSync(sync); }, () => { /* 불러오기 실패 = 동기화 없이 동작 */ });
  }
  attachSync(sync: SyncService) {
    this.sync = sync; this.forceUpdate();
    this.off.push(sync.subscribe(() => this.setState({ syncStatus: sync.status })));
    sync.attach({
      getData: () => this.state.data,
      getPrefs: () => ({ prefs: this.state.prefs, prefsT: this.state.prefsT }),
      applyRemote: (cats, prefs, mode = 'merge') => new Promise<void>(res => {
        let added: JoinResult | null = null;
        this.setState(s => {
          let data: Data, active = s.active;
          if (mode === 'replace') { data = { cats }; this.hist = []; }
          else if (mode === 'add') {
            // 계정에 추가하기: 실행 취소 목표는 "새 항목을 넣기 전의 계정 내용" (이전 히스토리는 서버 내용이 없는 상태라 버린다)
            const r = addToAccount(s.data, cats); added = r;
            data = r.data; this.hist = [r.base]; active = r.catMap[s.active] ?? s.active;
          } else {
            data = mergeData(s.data, cats);
            // 실행 취소 히스토리에도 원격 변경을 반영해 두어야 실행 취소가 다른 기기의 변경을 지우지 않는다
            this.hist = this.hist.map(h => rebaseSnapshot(h, s.data, data));
          }
          const p = prefs ? mergePrefs({ prefs: s.prefs, prefsT: s.prefsT }, prefs) : null;
          return { data, active, ...(p ? { prefs: p.prefs, prefsT: p.prefsT } : {}) } as State;
        }, () => {
          const cs = this.cats;
          if (cs.length && !cs.some(c => c.id === this.state.active)) this.setState({ active: cs[0].id });
          if (mode === 'replace') { this.userMoved = false; setTimeout(() => this.fit(), 0); }
          if (added) this.afterAdd(added);
          this.scheduleSave();
          res();
        });
      }),
      askJoin: plan => this.setState({ joinAsk: plan, joinStep: 'ask', joinBusy: false, joinErr: null }),
    });
    const check = () => { if (document.visibilityState === 'visible') sync.syncNow(); };
    window.addEventListener('online', check); window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    this.off.push(() => { window.removeEventListener('online', check); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); });
    const poll = window.setInterval(check, 60000); this.off.push(() => clearInterval(poll));
  }
  componentWillUnmount() { this.off.forEach(f => f()); clearInterval(this.noiseTimer); this.flushSave(); }
  componentDidUpdate() {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-edit-ta]');
    if (ta && this.focusEdit) { this.focusEdit = false; ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
    const rn = document.querySelector<HTMLInputElement>('[data-rename]');
    if (rn && this.focusRename) { this.focusRename = false; rn.focus(); rn.select(); }
  }
  startNoise() {
    const c = this.noiseRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    this.sizeNoise = () => { c.width = Math.ceil(window.innerWidth); c.height = Math.ceil(window.innerHeight); };
    this.sizeNoise();
    this.noiseTimer = window.setInterval(() => {
      if (document.hidden || this.state.prefs.grain === 0) return;
      if (!c.width || !c.height) this.sizeNoise?.();
      const w = c.width, h = c.height; if (!w || !h) return;
      const img = ctx.createImageData(w, h), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = v * 0.9 + 20; d[i + 1] = v * 0.9 + 20; d[i + 2] = 255; d[i + 3] = Math.random() < 0.4 ? Math.random() * 110 : 0; }
      ctx.putImageData(img, 0, 0);
    }, 140);
  }

  // ── 데이터 ──────────────────────────────────────────
  // 모든 변경은 여기를 지나며, 참조가 바뀐 항목은 stampChanges가 updatedAt을 찍는다.
  setData(fn: (d: Data) => Data, push = true) {
    this.setState(s => {
      const nd = fn(s.data); if (nd === s.data) return null;
      if (push) { this.hist.push(s.data); if (this.hist.length > 100) this.hist.shift(); }
      return { data: stampChanges(s.data, nd) } as State;
    }, () => this.scheduleSave());
  }
  updCat(fn: (c: Category) => Category, push = true) {
    const id = this.cat.id;
    this.setData(d => ({ ...d, cats: d.cats.map(c => (c.id === id ? fn(c) : c)) }), push);
  }
  snapshot() { this.hist.push(this.state.data); if (this.hist.length > 100) this.hist.shift(); }
  // 되돌린 상태도 새 updatedAt을 받는다(applyTarget) — 2단계에서 다른 기기에 그대로 전파되도록
  undo() {
    const prev = this.hist.pop(); if (!prev) return;
    this.setState(s => ({ data: applyTarget(s.data, prev), sel: [], editing: null, connectFrom: null }), () => {
      if (!this.cats.some(c => c.id === this.state.active)) this.setState({ active: this.cats[0].id });
      this.scheduleSave();
    });
  }
  setPref(p: Partial<Prefs>) {
    this.setState(s => {
      const prefsT = { ...s.prefsT };
      (Object.keys(p) as (keyof Prefs)[]).forEach(k => { if (s.prefs[k] !== p[k]) prefsT[k] = tick(); });
      return { prefs: { ...s.prefs, ...p }, prefsT };
    }, () => this.scheduleSave());
  }
  // 현재 카테고리 비우기: 지우기 전 스냅샷 1회(setData) → Ctrl/⌘+Z 한 번으로 복구. 항목은 deletedAt만 기록(clearCategory)
  clearCat(what: 'all' | 'strokes') {
    const id = this.cat.id;
    this.setData(d => ({ ...d, cats: d.cats.map(c => (c.id === id ? clearCategory(c, what) : c)) }));
    this.setState(s => ({ clearOpen: false, editing: null, connectFrom: null, sel: what === 'all' ? [] : s.sel }));
  }
  // ── 새로 연결한 기기: 이 기기 내용을 계정에 더하거나, 백업해 두고 계정 내용으로 바꾸기 ──
  joinAdd() { this.setState({ joinAsk: null }); this.sync?.chooseJoin('add'); }
  async joinReplace() {
    if (this.state.joinBusy) return;
    this.setState({ joinBusy: true, joinErr: null });
    try { await saveLocalBackup(this.state.data); } catch {
      this.setState({ joinBusy: false, joinErr: '백업을 만들지 못해서 바꾸지 않았어요. 저장 공간을 확인해 주세요.' });
      return;
    }
    this.setState({ joinAsk: null, joinBusy: false });
    this.sync?.chooseJoin('replace');
    this.showToast('이 기기 내용은 백업해 두었어요');
  }
  // 추가한 카테고리는 전체 보기로 맞추고 짧게 알린다
  afterAdd(r: JoinResult) {
    const a = r.added; if (!(a.cats + a.boxes + a.links + a.strokes)) return;
    const views = { ...this.state.views };
    for (const id of r.touched) { const c = this.state.data.cats.find(x => x.id === id); if (c) views[id] = this.fitView(c); }
    if (r.touched.includes(this.cat.id)) this.userMoved = false;
    this.setState({ views }, () => this.scheduleSave());
    this.showToast(a.boxes ? `${a.boxes}개 상자를 추가했어요` : '이 기기 내용을 추가했어요');
  }
  showToast(msg: string) {
    clearTimeout(this.toastT);
    this.setState({ toast: msg });
    this.toastT = window.setTimeout(() => this.setState({ toast: null }), 2600);
  }
  // 설정 > 동기화 > 이전 기기 데이터 복구: 백업을 지금 데이터에 "계정에 추가하기"와 같은 방식으로 더한다 (실행 취소 가능)
  restoreBackup = async (id: string): Promise<number> => {
    const b = await getLocalBackup(id); if (!b) return 0;
    await restoreBackupImages(b);
    let r: JoinResult | null = null;
    await new Promise<void>(res => this.setState(s => {
      const x = addToAccount(b.data, s.data.cats);
      if (!(x.added.cats + x.added.boxes + x.added.links + x.added.strokes)) return null;
      r = x; this.hist.push(s.data); if (this.hist.length > 100) this.hist.shift();
      return { data: x.data, sel: [], editing: null, connectFrom: null } as unknown as State;
    }, res));
    const done = r as JoinResult | null;
    if (!done) { this.showToast('더할 내용이 없어요'); return 0; }
    this.afterAdd(done);
    if (done.touched.length && !done.touched.includes(this.cat.id)) this.switchTo(done.touched[0]);
    return done.added.boxes;
  };
  // 로그아웃 "이 기기 데이터도 지우기": 저장을 멈추고 기기 저장소를 초기 예시 데이터로 바꾼 뒤 다시 시작
  wiping = false;
  wipeLocal = async () => {
    this.wiping = true; clearTimeout(this.saveT); this.saveT = 0;
    await resetAll();
    location.reload();
  };
  persisted(): Persisted {
    const s = this.state;
    return { schema: 2, data: s.data, prefs: s.prefs, prefsT: s.prefsT, views: s.views, active: s.active, clock: clockValue() };
  }
  scheduleSave() {
    if (this.wiping) return;
    if (this.state.saveStatus !== 'SAVING…' && !this.state.saveErr) this.setState({ saveStatus: 'SAVING…' });
    clearTimeout(this.saveT);
    this.saveT = window.setTimeout(() => this.flushSave(), 500);
  }
  flushSave() {
    if (!this.saveT || this.wiping) return;
    clearTimeout(this.saveT); this.saveT = 0;
    saveAll(this.persisted()).then(
      () => { this.setState({ saveStatus: 'SAVED ' + hhmm(), saveErr: false }); this.sync?.localChanged(); },
      () => this.setState({ saveStatus: 'STORAGE FULL — 백업 권장', saveErr: true }),
    );
  }

  // ── 뷰 ──────────────────────────────────────────────
  // 화면 위치(pan/zoom)는 기기 로컬 정보라 updatedAt을 찍지 않는다.
  setView(v: Partial<View>) {
    const id = this.cat.id;
    this.setState(s => ({ views: { ...s.views, [id]: { ...(s.views[id] || this.view()), ...v } } }), () => this.scheduleSave());
  }
  setViewUser(v: Partial<View>) { this.userMoved = true; this.setView(v); }
  fitMargins() {
    if (this.mobile) return { L: 16, T: 60, R: 16, B: 130 };
    return { L: 80, T: 60, R: this.state.sel.length ? 250 : 30, B: 70 };
  }
  fit() {
    const c = this.cat; if (!window.innerWidth || !window.innerHeight || !c) return;
    this.setView(this.fitView(c));
  }
  // 카테고리 전체가 보이는 화면 위치 (지금 보고 있지 않은 카테고리도)
  fitView(c: Category): View {
    const W = window.innerWidth, H = window.innerHeight;
    const xs: number[] = [], ys: number[] = [];
    liveBoxes(c).forEach(b => { xs.push(b.x, b.x + b.w); ys.push(b.y, b.y + b.h); });
    liveStrokes(c).forEach(s => s.pts.forEach(p => { xs.push(p[0]); ys.push(p[1]); }));
    const { L, T, R, B: Bm } = this.fitMargins(), aw = W - L - R, ah = H - T - Bm;
    if (!xs.length) return { x: L + aw / 2, y: T + ah / 2, z: 1 };
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
    const ze = Math.max(0.2 * K, Math.min(1.2 * K, aw / (maxX - minX), ah / (maxY - minY)));
    return { z: ze / K, x: L + aw / 2 - ((minX + maxX) / 2) * ze, y: T + ah / 2 - ((minY + maxY) / 2) * ze };
  }
  zoomAt(cx: number, cy: number, z2: number) {
    this.userMoved = true;
    const v = this.view(), z = Math.max(0.2, Math.min(3, z2)), k = z / v.z;
    this.setView({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  }
  go(step: number) {
    const cs = this.cats, i = cs.findIndex(c => c.id === this.cat.id), n = cs.length;
    this.switchTo(cs[(i + step + n) % n].id);
  }
  switchTo(id: string) {
    if (id === this.cat.id) return;
    const cs = this.cats, cat = cs.find(c => c.id === id); if (!cat) return;
    const idx = cs.indexOf(cat);
    this.setState({ active: id, sel: [], editing: null, connectFrom: null, hover: null, flash: { name: cat.name, idx }, flashOn: true }, () => this.scheduleSave());
    clearTimeout(this.flashT); this.flashT = window.setTimeout(() => this.setState({ flashOn: false }), 700);
    if (!this.state.views[id]) setTimeout(() => this.fit(), 0);
  }
  // 편집 중인 상자가 화면 키보드에 가리지 않게 화면을 올린다
  onViewport() {
    const vv = window.visualViewport; if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    if (kb !== this.state.kb) this.setState({ kb });
    if (kb > 80 && this.state.editing) this.ensureVisible(this.state.editing, vv.offsetTop + vv.height);
  }
  ensureVisible(id: string, bottomLimit: number) {
    const b = this.cat.boxes.find(x => x.id === id); if (!b) return;
    const v = this.view(), z = v.z * K;
    const top = v.y + b.y * z, bot = v.y + (b.y + b.h) * z, topLimit = 70;
    let dy = 0;
    if (bot > bottomLimit - 12) dy = bottomLimit - 12 - bot;
    if (top + dy < topLimit) dy = topLimit - top;
    if (Math.abs(dy) > 1) this.setViewUser({ y: v.y + dy });
  }

  // ── 동작 ────────────────────────────────────────────
  createText(wx: number, wy: number) {
    const id = uid();
    this.updCat(c => ({ ...c, boxes: [...c.boxes, { id, type: 'text', x: Math.round(wx - 110), y: Math.round(wy - 14), w: 220, h: 110, text: '', head: null, updatedAt: 0, deletedAt: null }] }));
    this.focusEdit = true;
    // 터치 기기에서 화면 키보드가 뜨려면 포커스가 사용자 입력 처리 안에서 동기적으로 일어나야 한다
    flushSync(() => this.setState({ sel: [id], editing: id, tool: 'select' }));
  }
  startEdit(id: string) { this.snapshot(); this.focusEdit = true; flushSync(() => this.setState({ editing: id, sel: [id] })); }
  addLink(a: string, b: string) {
    if (a === b) return;
    if (liveLinks(this.cat).some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return;
    this.updCat(c => ({ ...c, links: [...c.links, { id: uid(), a, b, updatedAt: 0, deletedAt: null }] }));
  }
  deleteSel() {
    const del = new Set(this.state.sel); if (!del.size) return;
    const t = tick();
    this.updCat(c => ({
      ...c,
      boxes: c.boxes.map(b => (del.has(b.id) && alive(b) ? { ...b, deletedAt: t } : b)),
      links: c.links.map(l => (alive(l) && (del.has(l.a) || del.has(l.b)) ? { ...l, deletedAt: t } : l)),
    }));
    this.setState({ sel: [], editing: null });
  }
  unlink(id: string) { const t = tick(); this.updCat(c => ({ ...c, links: c.links.map(l => (l.id === id ? { ...l, deletedAt: t } : l)) })); }
  setTool(t: Tool) { this.setState(s => ({ tool: t, connectFrom: null, editing: t === 'select' ? s.editing : null })); }
  fmt(kind: string) {
    const id = this.state.sel[0], box = this.cat.boxes.find(b => b.id === id);
    if (!box || box.type !== 'text') return;
    if (this.state.editing !== id) { this.startEdit(id); setTimeout(() => this.fmt(kind), 40); return; }
    const ta = document.querySelector<HTMLTextAreaElement>('[data-edit-ta]'); const t = box.text || '';
    const s = ta ? ta.selectionStart : t.length, e = ta ? ta.selectionEnd : t.length;
    const wrap = ({ bold: '**', italic: '*', strike: '~~', code: '`' } as Record<string, string>)[kind];
    let nt: string, cs: number, ce: number;
    if (wrap) { const mid = t.slice(s, e) || '텍스트'; nt = t.slice(0, s) + wrap + mid + wrap + t.slice(e); cs = s + wrap.length; ce = cs + mid.length; }
    else {
      const pre = ({ h1: '# ', h2: '## ', ul: '- ', ol: '1. ', check: '- [ ] ', quote: '> ' } as Record<string, string>)[kind];
      if (kind === 'hr') { const ins = (t && !t.endsWith('\n') ? '\n' : '') + '---\n'; nt = t.slice(0, e) + ins + t.slice(e); cs = ce = e + ins.length; }
      else { const ls = t.lastIndexOf('\n', s - 1) + 1; nt = t.slice(0, ls) + pre + t.slice(ls); cs = s + pre.length; ce = e + pre.length; }
    }
    this.updCat(c => ({ ...c, boxes: c.boxes.map(b => (b.id === id ? { ...b, text: nt } : b)) }), false);
    setTimeout(() => { const a = document.querySelector<HTMLTextAreaElement>('[data-edit-ta]'); if (a) { a.focus({ preventScroll: true }); a.setSelectionRange(cs, ce); } }, 0);
  }
  // 긴 변 1200px로 줄여 JPEG 0.85 Blob으로 기기 저장소에 넣고, 상자에는 imageId만 둔다
  async addImages(files: File[]) {
    const c = this.toWorld(window.innerWidth / 2, window.innerHeight / 2);
    const ids: string[] = [];
    let n = 0;
    for (const file of files) {
      try {
        const url = URL.createObjectURL(file);
        const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
        const max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        const blob = await new Promise<Blob>((res, rej) => cv.toBlob(b => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.85));
        const imageId = uid();
        await putImage(imageId, blob);
        const w = 280, h = Math.round(Math.min(420, Math.max(90, (w * img.height) / img.width))) + 18;
        const id = uid(), off = n++ * 24;
        const box: Box = { id, type: 'image', x: Math.round(c.x - w / 2 + off), y: Math.round(c.y - h / 2 + off), w, h, imageId, head: null, updatedAt: 0, deletedAt: null };
        this.updCat(cat => ({ ...cat, boxes: [...cat.boxes, box] }));
        ids.push(id);
      } catch {
        this.setState({ saveStatus: 'STORAGE FULL — 백업 권장', saveErr: true });
      }
    }
    if (ids.length) this.setState({ sel: ids.slice(-1), tool: 'select' });
  }
  doExport() {
    exportBackup(this.state.data, this.state.prefs, this.state.touchMode).catch(() => window.alert('내보내기에 실패했습니다.'));
  }
  async doImport(file: File) {
    let raw;
    try { raw = validateBackup(await file.text()); } catch { window.alert('올바른 백업 파일이 아닙니다.'); return; }
    if (!window.confirm('백업 파일의 내용으로 현재 작업을 교체할까요?')) return;
    try {
      const { data, prefs } = await materializeBackup(raw);
      this.snapshot();
      this.setState(s => ({ data: applyTarget(s.data, data), sel: [], editing: null }), () => {
        const cs = this.cats; this.setState({ active: cs[0].id });
        this.setPref(prefs);
        this.userMoved = false; setTimeout(() => this.fit(), 0);
      });
    } catch { window.alert('올바른 백업 파일이 아닙니다.'); }
  }
  moveCat(from: string, to: string) {
    if (from === to) return;
    this.setData(d => {
      const vis = visibleCats(d), fi = vis.findIndex(x => x.id === from), ti = vis.findIndex(x => x.id === to);
      if (fi < 0 || ti < 0) return d;
      const arr = vis.filter(x => x.id !== from), mv = vis[fi];
      const at = arr.findIndex(x => x.id === to);
      arr.splice(fi < ti ? at + 1 : at, 0, mv);
      const i = arr.indexOf(mv), a = arr[i - 1], b = arr[i + 1];
      // 순서는 카테고리마다 order 값으로 둔다 → 옮긴 카테고리 하나만 바뀐다
      const order = a && b ? (a.order + b.order) / 2 : a ? a.order + 1 : b ? b.order - 1 : 1;
      return { ...d, cats: d.cats.map(c => (c.id === from ? { ...c, order } : c)) };
    });
  }
  nudgeCat(id: string, dir: number) {
    const cs = this.cats, i = cs.findIndex(c => c.id === id), j = i + dir;
    if (j < 0 || j >= cs.length) return;
    this.moveCat(id, cs[j].id);
    this.focusRename = true;
  }
  clearPairCode = () => { if (this.state.pairCode) this.setState({ pairCode: null }); };
  dismissIosHint() {
    try { localStorage.setItem(IOS_HINT_KEY, '1'); } catch { /* 무시 */ }
    this.setState({ iosHint: false });
  }

  // ── 입력: 포인터 공통 ─────────────────────────────────
  // 캡처 단계에서 모든 포인터를 먼저 본다: 터치 개수 추적(핀치), 펜 감지, 터치/마우스 모드 전환.
  onAnyDown(e: PointerEvent) {
    this.lastPT = e.pointerType;
    if (e.pointerType === 'pen') this.penSeen = true;
    const tm = e.pointerType === 'touch' || (e.pointerType === 'pen' && mq('(pointer: coarse)'));
    if (tm !== this.state.touchMode) this.setState({ touchMode: tm });
    if (e.pointerType !== 'touch') return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2 && !(e.target as Element).closest?.('[data-ui]')) this.beginPinch();
  }
  beginPinch() {
    clearTimeout(this.longT);
    const d = this.drag;
    if (d) {
      if (d.type === 'draw') this.setState({ liveStroke: null });
      if (d.type === 'swipe' || d.type === 'edge') this.setState({ swipe: 0 });
      if (d.type === 'pan') this.setState({ panning: false });
      if (d.type === 'move' || d.type === 'resize') this.setState({ dragging: false });
      this.drag = null;
    }
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, w = this.toWorld(mid.x, mid.y);
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.view().z, wx: w.x, wy: w.y };
    this.ignoreTouches = true;
  }
  // 두 손가락 중심 기준 확대 + 중심 이동에 따른 팬
  doPinch() {
    const p = this.pinch; if (!p) return;
    const [a, b] = [...this.touches.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const z = Math.max(0.2, Math.min(3, p.z0 * Math.hypot(a.x - b.x, a.y - b.y) / p.d0)), ze = z * K;
    this.setViewUser({ z, x: mid.x - p.wx * ze, y: mid.y - p.wy * ze });
  }
  touchBlocked(e: React.PointerEvent) { return e.pointerType === 'touch' && (this.touches.size > 1 || this.ignoreTouches); }
  isDouble(e: { clientX: number; clientY: number }, target: string) {
    const now = Date.now(), l = this.lastTap;
    const dbl = !!l && l.target === target && now - l.t < DOUBLE_TAP && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 30;
    this.lastTap = dbl ? null : { t: now, x: e.clientX, y: e.clientY, target };
    return dbl;
  }

  onBgDown(e: React.PointerEvent) {
    if (this.touchBlocked(e)) return;
    if (this.state.renaming) this.setState({ renaming: null });
    const { tool, space } = this.state, v = this.view(), pt = e.pointerType, id = e.pointerId;
    const startDraw = () => { const w = this.toWorld(e.clientX, e.clientY); this.drag = { type: 'draw', id }; this.setState({ liveStroke: [[w.x, w.y]] }); };
    // 애플 펜슬 등 펜은 도구와 상관없이 바로 그리기
    if (pt === 'pen' && tool !== 'pan' && !space) { startDraw(); return; }
    if (pt === 'touch') {
      const x = e.clientX, W = window.innerWidth;
      if (x < EDGE_ZONE || x > W - EDGE_ZONE) { this.drag = { type: 'edge', id, sx: x, sy: e.clientY }; return; }
      // 펜을 쓰는 기기에서는 손가락 = 팬, 펜이 없으면 DRAW 도구에서 손가락으로 그린다
      if (tool === 'draw' && !this.penSeen) { startDraw(); return; }
      this.drag = { type: 'pan', id, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, tap: true };
      return;
    }
    switch (mouseAction({ part: 'bg', button: e.button, tool, space })) {
      // 우클릭 드래그: 도구와 상관없이 좌우로 끌어 카테고리 전환 (상자 위에서 눌러도 여기로 온다)
      case 'swipe': this.drag = { type: 'swipe', id, sx: e.clientX, sy: e.clientY }; return;
      case 'pan': e.preventDefault(); this.drag = { type: 'pan', id, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y }; this.setState({ panning: true }); return;
      case 'draw': startDraw(); return;
      case 'text': { const w = this.toWorld(e.clientX, e.clientY); this.createText(w.x, w.y); return; }
      case 'connect-cancel': this.setState({ connectFrom: null }); return;
      // SELECT 도구로 빈 곳 좌클릭: 3px 넘게 끌면 화면 이동, 아니면 클릭(선택 해제)
      case 'click-pan':
        this.setState({ editing: null });
        this.drag = { type: 'pan', id, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, click: true, shift: e.shiftKey };
        return;
    }
  }
  // 터치 탭(움직임 없음) 처리: 도구별로 마우스 클릭과 같은 결과
  bgTap(e: PointerEvent) {
    const { tool } = this.state;
    if (tool === 'text') { const w = this.toWorld(e.clientX, e.clientY); this.createText(w.x, w.y); return; }
    if (tool === 'connect') { this.setState({ connectFrom: null }); return; }
    if (tool !== 'select') return;
    if (this.isDouble(e, 'bg')) { const w = this.toWorld(e.clientX, e.clientY); this.createText(w.x, w.y); return; }
    this.setState({ sel: [], editing: null });
  }

  onMove(e: PointerEvent) {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.touches.size >= 2) { this.doPinch(); return; }
    }
    if (this.state.connectFrom && e.pointerType !== 'touch') { const w = this.toWorld(e.clientX, e.clientY); this.setState({ mouseW: w }); }
    const d = this.drag; if (!d || d.id !== e.pointerId) return;
    const z = this.view().z * K;
    if (d.type === 'draw') { const w = this.toWorld(e.clientX, e.clientY); this.setState(s => { const p = s.liveStroke; if (!p) return null; const l = p[p.length - 1]; return Math.hypot(w.x - l[0], w.y - l[1]) * z > 2 ? { liveStroke: [...p, [w.x, w.y]] } : null; }); return; }
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.type === 'pan') {
      const slop = d.tap ? 8 : d.click ? CLICK_SLOP : 0;
      if (slop && !d.moved) { if (Math.hypot(dx, dy) < slop) return; d.moved = true; this.setState({ panning: true }); }
      this.setViewUser({ x: d.ox + dx, y: d.oy + dy });
    }
    else if (d.type === 'swipe') { if (Math.abs(dx) > 8) this.setState({ swipe: dx }); d.dx = dx; d.dy = dy; }
    else if (d.type === 'edge') { d.dx = dx; d.dy = dy; this.setState({ swipe: Math.abs(dx) > 6 ? dx * (MOUSE_SWIPE / EDGE_SWIPE) : 0 }); }
    else if (d.type === 'boxTouch') {
      if (d.consumed) {
        // 내용이 넘치는 상자 본문은 손가락으로 세로 스크롤
        if (d.scrollEl && d.ly != null) { d.scrollEl.scrollTop -= e.clientY - d.ly; d.ly = e.clientY; }
        return;
      }
      if (Math.hypot(dx, dy) < 8) return;
      clearTimeout(this.longT);
      const box = this.cat.boxes.find(b => b.id === d.box); if (!box) { this.drag = null; return; }
      if (d.part === 'handle') {
        const ns = this.boxSelect(box.id, false);
        const orig: Record<string, { x: number; y: number }> = {}; this.cat.boxes.forEach(x => { if (ns.includes(x.id)) orig[x.id] = { x: x.x, y: x.y }; });
        this.drag = { type: 'move', id: d.id, sx: d.sx, sy: d.sy, orig };
      } else if (d.scrollEl && d.scrollEl.scrollHeight > d.scrollEl.clientHeight + 1 && Math.abs(dy) > Math.abs(dx)) {
        d.consumed = true; d.ly = e.clientY;
        return;
      } else {
        const v = this.view();
        this.drag = { type: 'pan', id: d.id, sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y };
        this.setState({ panning: true });
        return;
      }
      this.onMove(e);
    }
    else if (d.type === 'move' || d.type === 'resize') {
      if (!d.pushed) { if (Math.hypot(dx, dy) < 3) return; this.snapshot(); d.pushed = true; this.setState({ dragging: true }); }
      if (d.type === 'move') this.updCat(c => ({ ...c, boxes: c.boxes.map(b => (d.orig[b.id] ? { ...b, x: Math.round(d.orig[b.id].x + dx / z), y: Math.round(d.orig[b.id].y + dy / z) } : b)) }), false);
      else this.updCat(c => ({ ...c, boxes: c.boxes.map(b => (b.id === d.box ? { ...b, w: Math.max(120, Math.round(d.ow + dx / z)), h: Math.max(60, Math.round(d.oh + dy / z)) } : b)) }), false);
    }
  }
  onUp(e: PointerEvent, cancel = false) {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.pinch = null;
      if (this.touches.size === 0) this.ignoreTouches = false;
    }
    const d = this.drag; if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    clearTimeout(this.longT);
    if (d.type === 'pan') {
      this.setState({ panning: false });
      if (d.tap && !d.moved && !cancel) this.bgTap(e);
      if (d.click && !d.moved && !cancel && !d.shift) this.setState({ sel: [] });
    }
    if (d.type === 'draw') {
      const pts = this.state.liveStroke || []; const { penColor, penWidth } = this.state.prefs;
      if (pts.length <= 1 && e.pointerType === 'pen' && !cancel) this.bgTap(e);
      if (pts.length > 1 && !cancel) this.updCat(c => ({ ...c, strokes: [...c.strokes, { id: uid(), color: penColor, width: penWidth, pts: pts.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as [number, number]), updatedAt: 0, deletedAt: null }] }));
      this.setState({ liveStroke: null });
    }
    if (d.type === 'swipe') {
      // 오른쪽으로 끌면 이전, 왼쪽으로 끌면 다음. 기준에 못 미치면 제자리로
      const dx = d.dx || 0, dy = d.dy || 0;
      this.setState({ swipe: 0 });
      this.swipeEndAt = Date.now();
      if (!cancel && Math.abs(dx) >= MOUSE_SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(dx < 0 ? 1 : -1);
    }
    if (d.type === 'edge') {
      const dx = d.dx || 0, dy = d.dy || 0;
      this.setState({ swipe: 0 });
      if (!cancel && Math.abs(dx) > EDGE_SWIPE && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(dx < 0 ? 1 : -1);
      else if (!cancel && Math.hypot(dx, dy) < 8) this.bgTap(e);
    }
    if (d.type === 'boxTouch' && !d.consumed && !cancel) {
      // 탭: 선택, 두 번 탭: 편집 (dc.html 더블클릭과 동일)
      const box = this.cat.boxes.find(b => b.id === d.box);
      if (box) {
        if (this.isDouble(e, box.id) && box.type === 'text' && this.state.tool === 'select') this.startEdit(box.id);
        else this.boxSelect(box.id, false);
      }
    }
    if (d.type === 'move' || d.type === 'resize') this.setState({ dragging: false });
  }

  // 트랙패드 두 손가락 이동·마우스 휠: deltaX·deltaY 그대로 자유 이동 (OS 관성 스크롤이 그대로 반영됨)
  // Ctrl/⌘ + 휠(트랙패드 오므리기): 커서 기준 확대. Space를 누른 채 좌우 스와이프: 카테고리 전환 전용(화면은 안 움직임)
  onWheel(e: WheelEvent) {
    const t = e.target as Element;
    if (t.closest && t.closest('[data-ui]')) return;
    const sc = t.closest && t.closest('[data-scroll]');
    if (sc && sc.scrollHeight > sc.clientHeight + 1 && !e.ctrlKey && !e.metaKey && !this.state.space) return;
    e.preventDefault();
    // 줄·페이지 단위(일부 마우스·Firefox)는 픽셀로 환산
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    let ddx = e.deltaX * unit, ddy = e.deltaY * unit;
    const v = this.view();
    if (e.ctrlKey || e.metaKey) { this.zoomAt(e.clientX, e.clientY, v.z * Math.exp(-ddy * 0.01)); return; }
    // Shift + 세로 휠 = 가로 이동 (브라우저가 이미 가로로 바꿔 준 경우는 그대로)
    if (e.shiftKey && !ddx) { ddx = ddy; ddy = 0; }
    if (this.state.space) {
      clearTimeout(this.wT); this.wT = window.setTimeout(() => { this.wAcc = 0; this.setState({ swipe: 0 }); }, 220);
      if (Date.now() < this.wCool) return;
      this.wAcc += ddx;
      this.setState({ swipe: -this.wAcc * (MOUSE_SWIPE / WHEEL_SWIPE) });
      if (Math.abs(this.wAcc) > WHEEL_SWIPE) { this.go(this.wAcc > 0 ? 1 : -1); this.wAcc = 0; this.wCool = Date.now() + 700; this.setState({ swipe: 0 }); }
      return;
    }
    this.setViewUser({ x: v.x - ddx, y: v.y - ddy });
  }
  onKey(e: KeyboardEvent) {
    const tag = (e.target as Element).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { e.preventDefault(); if (!this.state.space) this.setState({ space: true }); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSel(); return; }
    if (e.key === 'Escape' && (this.drag?.type === 'swipe' || this.wAcc)) { this.drag = null; this.wAcc = 0; this.setState({ swipe: 0 }); return; }
    if (e.key === '[' || e.key === ']') { e.preventDefault(); this.go(e.key === ']' ? 1 : -1); return; }
    if (e.key === 'Escape') { this.setState({ sel: [], editing: null, connectFrom: null, helpOpen: false, licensesOpen: false, clearOpen: false, joinAsk: null }); return; }
    if (e.key === 'Enter' && this.state.sel.length === 1) { const b = this.cat.boxes.find(x => x.id === this.state.sel[0]); if (b && b.type === 'text') { e.preventDefault(); this.startEdit(b.id); } return; }
    const map: Record<string, Tool> = { v: 'select', h: 'pan', t: 'text', p: 'draw', c: 'connect' };
    const k = e.key.toLowerCase();
    if (map[k]) this.setTool(map[k]);
    else if (k === 'i') this.fileRef.current?.click();
  }
  boxSelect(id: string, shift: boolean) {
    const sel = this.state.sel;
    const ns = shift ? (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]) : (sel.includes(id) ? sel : [id]);
    this.setState({ sel: ns, editing: this.state.editing === id ? id : null });
    return ns;
  }
  passThrough() { const { tool, space } = this.state; return space || tool === 'pan' || tool === 'draw' || tool === 'text'; }

  // 상자 위 포인터: 마우스/펜은 dc.html과 같이 즉시 처리, 터치는 탭·길게 누르기·끌기를 구분
  onBoxDown(e: React.PointerEvent, b: Box, part: 'body' | 'handle') {
    if (this.touchBlocked(e)) return;
    const s = this.state;
    if (e.pointerType !== 'touch') {
      // 펜은 SELECT·PAN·LINK 도구가 아니면 상자 위에서도 그리기 (배경으로 넘김)
      if (e.pointerType === 'pen' && !s.space && s.tool !== 'pan' && s.tool !== 'select' && s.tool !== 'connect') return;
      const act = mouseAction({ part, button: e.button, tool: s.tool, space: s.space });
      if (act === 'bubble') return;
      e.stopPropagation();
      if (act === 'connect') {
        if (!s.connectFrom) this.setState({ connectFrom: b.id, mouseW: null });
        else { this.addLink(s.connectFrom, b.id); this.setState({ connectFrom: null }); }
      } else if (act === 'select') {
        if (s.editing !== b.id) this.boxSelect(b.id, e.shiftKey);
      } else if (act === 'move') {
        const ns = this.boxSelect(b.id, e.shiftKey);
        if (!ns.includes(b.id)) return;
        const orig: Record<string, { x: number; y: number }> = {}; this.cat.boxes.forEach(x => { if (ns.includes(x.id)) orig[x.id] = { x: x.x, y: x.y }; });
        this.drag = { type: 'move', id: e.pointerId, sx: e.clientX, sy: e.clientY, orig };
      }
      return;
    }
    if (this.passThrough()) return;
    if (this.penSeen && s.tool === 'draw') return;
    e.stopPropagation();
    if (s.tool === 'connect') {
      if (!s.connectFrom) this.setState({ connectFrom: b.id, mouseW: null });
      else { this.addLink(s.connectFrom, b.id); this.setState({ connectFrom: null }); }
      return;
    }
    if (s.editing === b.id && part === 'body') return;
    const scrollEl = (e.target as Element).closest<HTMLElement>('[data-scroll]');
    this.drag = { type: 'boxTouch', id: e.pointerId, sx: e.clientX, sy: e.clientY, box: b.id, part, scrollEl };
    clearTimeout(this.longT);
    // 길게 누르기 = 다중 선택 토글 (Shift+클릭과 같음)
    this.longT = window.setTimeout(() => {
      const d = this.drag; if (!d || d.type !== 'boxTouch' || d.box !== b.id) return;
      d.consumed = true; this.lastTap = null;
      this.boxSelect(b.id, true);
      navigator.vibrate?.(12);
    }, LONG_PRESS);
  }

  // 우하단 리사이즈 핸들: 도구·입력 종류와 상관없이 항상 크기 조절. 캔버스 이동·상자 이동·카테고리 전환보다 먼저 잡고
  // 포인터를 이 핸들에 붙잡아(setPointerCapture) 드래그가 끝날 때까지 다른 요소가 가로채지 못하게 한다.
  onResizeDown(e: React.PointerEvent, b: Box) {
    e.stopPropagation();
    if (this.touchBlocked(e)) return;
    if (mouseAction({ part: 'resize', button: e.button, tool: this.state.tool, space: this.state.space }) !== 'resize') { e.preventDefault(); return; }
    e.preventDefault();
    clearTimeout(this.longT);
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* 캡처를 못 해도 창 단위 이벤트로 동작 */ }
    this.setState({ sel: [b.id] });
    // 실행 취소 스냅샷은 실제로 움직이기 시작할 때 1회 (onMove의 pushed)
    this.drag = { type: 'resize', id: e.pointerId, sx: e.clientX, sy: e.clientY, box: b.id, ow: b.w, oh: b.h };
  }

  // ── 렌더: 연결선·그림 레이어 ─────────────────────────
  linksSvg(ec: string, c: Category, boxes: Box[]) {
    const s = this.state;
    const byId = Object.fromEntries(boxes.map(b => [b.id, b]));
    const rk = boxes.map(b => `${b.id}:${b.x},${b.y},${b.w},${b.h}`).join(';');
    if (this.routeCache.size > 400) this.routeCache.clear();
    const kids: React.ReactNode[] = [];
    const rr = CORNER === 'soft' ? 8 : 0;
    liveStrokes(c).forEach(st => {
      const d = smooth(st.pts);
      kids.push(<path key={st.id + 'g'} d={d} stroke={st.color} strokeWidth={st.width + 5} opacity={0.18} fill="none" strokeLinecap="round" strokeLinejoin="round" filter="url(#eblur)" />,
        <path key={st.id} d={d} stroke={st.color} strokeWidth={st.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />);
    });
    if (s.liveStroke) kids.push(<path key="live" d={smooth(s.liveStroke)} stroke={s.prefs.penColor} strokeWidth={s.prefs.penWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />);
    const neuron = EDGE_STYLE !== 'circuit';
    liveLinks(c).forEach((l, i) => {
      const A = byId[l.a], B = byId[l.b]; if (!A || !B) return;
      let pts: Pt[] | null | undefined;
      if (neuron) pts = ports(A, B);
      else {
        const key = l.a + '>' + l.b + '|' + rk;
        pts = this.routeCache.get(key);
        if (pts === undefined) { pts = route(A, B, boxes); this.routeCache.set(key, pts); }
      }
      if (!pts) return;
      const d = neuron ? curve(A, B) : roundPath(pts, rr);
      const hot = [s.hover, ...s.sel].some(x => x && (x === l.a || x === l.b));
      const a0 = pts[0], a1 = pts[pts.length - 1];
      kids.push(
        <path key={l.id + 'g'} d={d} stroke={ec} strokeWidth={hot ? 8 : 5} opacity={hot ? 0.5 : 0.25} fill="none" filter="url(#eblur)" />,
        <path key={l.id + 'c'} d={d} stroke={ec} strokeWidth={hot ? 1.8 : 1.2} opacity={hot ? 1 : 0.85} fill="none" />,
      );
      if (neuron) kids.push(
        <path key={l.id + 'n'} d={dendrite(d, i)} stroke={ec} strokeWidth={0.7} opacity={0.3} fill="none" strokeDasharray="1 5" />,
        <circle key={l.id + 'a'} cx={a0.x} cy={a0.y} r={2.5} fill={ec} />,
        <circle key={l.id + 'b'} cx={a1.x} cy={a1.y} r={3.5} fill={ec} />,
      );
      else kids.push(
        <rect key={l.id + 'a'} x={a0.x - 3} y={a0.y - 3} width={6} height={6} fill={ec} />,
        <rect key={l.id + 'b'} x={a1.x - 3} y={a1.y - 3} width={6} height={6} fill="#05060B" stroke={ec} strokeWidth={1.2} />,
      );
      if (s.prefs.pulse) kids.push(
        <circle key={l.id + 'p' + d} r={2.6} fill="#fff" filter="url(#pglow)">
          <animateMotion dur={(2.6 + (i % 4) * 0.6) + 's'} repeatCount="indefinite" path={d} begin={-(i * 0.8) + 's'} />
        </circle>,
      );
    });
    if (s.connectFrom && s.mouseW && byId[s.connectFrom]) {
      const A = byId[s.connectFrom];
      kids.push(<path key="cpre" d={`M ${A.x + A.w / 2} ${A.y + A.h / 2} L ${s.mouseW.x} ${s.mouseW.y}`} stroke={ec} strokeWidth={1.2} strokeDasharray="4 4" fill="none" />);
    }
    return (
      <svg style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none' }}>
        <defs>
          <filter id="eblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={4} /></filter>
          <filter id="pglow" x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation={2.5} result="b" /><feFlood floodColor={ec} /><feComposite in2="b" operator="in" result="c" />
            <feMerge><feMergeNode in="c" /><feMergeNode in="c" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {kids}
      </svg>
    );
  }

  // ── 렌더: 상자 ──────────────────────────────────────
  renderBox(b: Box, i: number, nc: string, ec: string, ze: number) {
    const s = this.state;
    const sel = s.sel.includes(b.id), hov = s.hover === b.id, edit = s.editing === b.id, from = s.connectFrom === b.id;
    let body: React.ReactNode = null;
    if (b.type === 'text' && !edit) {
      const text = b.text || '';
      const key = text + '|' + nc;
      let html = this.mdCache.get(key);
      if (html === undefined) { html = text.trim() ? md(text, nc) : '<span style="opacity:.35">빈 상자 — 더블클릭해서 작성</span>'; if (this.mdCache.size > 300) this.mdCache.clear(); this.mdCache.set(key, html); }
      body = <div data-scroll="1" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 12px', fontFamily: "'Galmuri11',monospace", fontSize: 12.5, lineHeight: 1.55, color: '#E3E4F2', textShadow: `0 0 8px ${rgba(nc, 0.6)}`, wordBreak: 'keep-all', overflowWrap: 'anywhere', touchAction: 'none' }} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    const lit = sel || hov;
    let line = lit ? rgba(nc, 0.4) : 'transparent', handleOp = lit || edit ? 1 : 0.45;
    if (b.head) { handleOp = 1; line = b.head; }
    const tag = (b.type === 'image' ? 'IMG-' : 'TXT-') + String(i + 1).padStart(2, '0');
    const state = edit ? 'EDIT_' : from ? 'LINK…' : sel ? 'SEL' : '';
    const tick6 = sel ? nc : 'transparent';
    // 터치일 때 손잡이·리사이즈 판정 영역을 화면 기준 최소 44px로 (보이는 크기는 그대로)
    const big = s.touchMode;
    const hitH = big ? Math.max(18, 44 / ze) : 18;
    const above = (hitH - 18) / 2, below = Math.max(0, Math.min((hitH - 18) / 2, b.h / 2 - 18));
    // 리사이즈 판정 영역: 터치는 화면 기준 44px, 마우스도 축소했을 때 너무 작아지지 않게 화면 기준 16px 이상
    const rs = Math.max(12, (big ? 44 : 16) / ze), rOff = (rs - 12) / 2;
    const handleDown = (e: React.PointerEvent) => this.onBoxDown(e, b, 'handle');
    const resizeDown = (e: React.PointerEvent) => this.onResizeDown(e, b);
    return (
      <div key={b.id} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, zIndex: lit ? 10 : 2 }}
        onPointerDown={e => this.onBoxDown(e, b, 'body')}
        onDoubleClick={e => { e.stopPropagation(); if (this.lastPT === 'touch') return; if (b.type === 'text' && s.tool === 'select') this.startEdit(b.id); }}
        onPointerEnter={e => { if (e.pointerType !== 'touch' && mq('(hover: hover)')) this.setState({ hover: b.id }); }}
        onPointerLeave={() => this.setState(st => (st.hover === b.id ? { hover: null } as State : null))}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', transform: `scale(${hov && !s.dragging && !edit ? 1.035 : 1})`, transition: 'transform .2s cubic-bezier(.2,.9,.3,1.3), box-shadow .2s, border-color .2s', background: 'rgba(7,8,14,.86)', border: `1px solid ${rgba(nc, lit ? 1 : 0.5)}`, borderRadius: CORNER === 'soft' ? 6 : 0, boxShadow: lit ? `0 0 20px ${rgba(nc, 0.5)}, 0 0 60px ${rgba(nc, 0.18)}, inset 0 0 14px ${rgba(nc, 0.16)}` : `0 0 12px ${rgba(nc, 0.16)}`, outline: from ? `1px dashed ${ec}` : 'none', outlineOffset: 5, backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}>
          <div onPointerDown={handleDown} style={{ height: 18, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 8px', cursor: 'move', borderBottom: `1px solid ${line}`, fontFamily: "'GalmuriMono9',monospace", fontSize: 9, letterSpacing: '.12em', color: b.head ? '#05060B' : nc, background: b.head || 'transparent', opacity: handleOp, transition: 'opacity .2s, background .2s' }}>
            <span>{tag}</span><span style={{ letterSpacing: 2, opacity: 0.6 }}>::::</span><span>{state}</span>
          </div>
          {edit && b.type === 'text' && (
            <textarea data-edit-ta="1" data-scroll="1" value={b.text || ''} spellCheck={false}
              placeholder={'# 제목\n- 목록\n**볼드** *기울임*'}
              onChange={e => { const val = e.target.value; this.updCat(cc => ({ ...cc, boxes: cc.boxes.map(x => (x.id === b.id ? { ...x, text: val } : x)) }), false); }}
              onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.setState({ editing: null }); } }}
              onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
              style={{ flex: 1, minHeight: 0, resize: 'none', background: 'rgba(0,0,0,.35)', border: 'none', padding: '10px 12px', margin: 0, color: '#E9EAF7', fontFamily: "'GalmuriMono11',monospace", fontSize: 12, lineHeight: 1.55, caretColor: nc, userSelect: 'text', WebkitUserSelect: 'text', touchAction: 'pan-y' }} />
          )}
          {body}
          {b.type === 'image' && <BoxImage id={b.imageId} />}
          <div style={{ position: 'absolute', left: -6, top: -6, width: 6, height: 6, borderLeft: `1px solid ${tick6}`, borderTop: `1px solid ${tick6}` }} />
          <div style={{ position: 'absolute', right: -6, top: -6, width: 6, height: 6, borderRight: `1px solid ${tick6}`, borderTop: `1px solid ${tick6}` }} />
          <div style={{ position: 'absolute', left: -6, bottom: -6, width: 6, height: 6, borderLeft: `1px solid ${tick6}`, borderBottom: `1px solid ${tick6}` }} />
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, pointerEvents: 'none', background: `linear-gradient(135deg, transparent 55%, ${nc} 55%)` }} />
          {big && <div onPointerDown={handleDown} style={{ position: 'absolute', left: 0, right: 0, top: -above, height: 18 + above + below, cursor: 'move' }} />}
          <div data-resize="1" onPointerDown={resizeDown} style={{ position: 'absolute', right: -rOff, bottom: -rOff, width: rs, height: rs, cursor: 'nwse-resize', touchAction: 'none', zIndex: 1 }} />
        </div>
      </div>
    );
  }

  // ── 렌더: 전체 ──────────────────────────────────────
  render() {
    const s = this.state, P = s.prefs, c = this.cat, v = this.view(), cs = this.cats;
    const nc = P.nodeColor, ec = P.linked ? nc : P.edgeColor;
    const idx = cs.indexOf(c), n = cs.length, ze = v.z * K;
    const mobile = this.mobile, compact = s.vw < 1000, touch = s.touchMode;
    const boxes = liveBoxes(c);
    const selBoxes = boxes.filter(b => s.sel.includes(b.id));
    const single = selBoxes.length === 1 ? selBoxes[0] : null;
    const links = liveLinks(c);
    const accentLine = rgba(nc, 0.38), glowSoft = rgba(nc, 0.14);
    const g = Math.round(28 * v.z * K);
    const swAbs = Math.abs(s.swipe), sd = s.swipe < 0 ? 1 : -1;
    const target = cs[(idx + sd + n) % n];
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const cursor = s.panning ? 'grabbing' : (s.space || s.tool === 'pan') ? 'grab' : s.tool === 'draw' ? 'crosshair' : s.tool === 'text' ? 'text' : s.tool === 'connect' ? 'cell' : 'default';
    const kbOpen = s.kb > 80;

    // 패널 공통
    const labelOf = (b?: Box) => { if (!b) return '?'; if (b.type === 'image') return 'IMAGE'; const ln = ((b.text || '').split('\n').find(x => x.trim()) || '빈 상자').replace(/^[#>\-*\d.\s[\]x]+/, '').replace(/[*_~`]/g, ''); return ln.slice(0, 22) || '빈 상자'; };
    const byId = Object.fromEntries(boxes.map(b => [b.id, b]));
    const panelLinks = single ? links.filter(l => l.a === single.id || l.b === single.id) : [];
    const pairLinked = selBoxes.length === 2 && links.some(l => (l.a === s.sel[0] && l.b === s.sel[1]) || (l.a === s.sel[1] && l.b === s.sel[0]));
    const selHeads = [...new Set(selBoxes.map(b => b.head || null))];
    const curHead = selHeads.length === 1 ? selHeads[0] : undefined;
    const setHead = (hex: string | null) => this.updCat(cc => ({ ...cc, boxes: cc.boxes.map(x => (s.sel.includes(x.id) ? { ...x, head: hex } : x)) }));

    const swatches = (list: { name: string; hex: string }[], cur: string | null, pick: (h: string) => void, h = 26, glow = true) => list.map(p => (
      <button key={p.hex} onClick={() => pick(p.hex)} title={p.name} style={{ height: h, background: p.hex, border: 'none', outline: cur === p.hex ? '1px solid #fff' : '1px solid transparent', outlineOffset: 3, cursor: 'pointer', boxShadow: glow ? `0 0 12px ${rgba(p.hex, cur === p.hex ? 0.6 : 0.12)}` : undefined }} />
    ));
    const toggle = (onv: boolean) => (
      <div style={{ width: 34, height: 16, border: `1px solid ${nc}`, position: 'relative', background: onv ? rgba(nc, 0.3) : 'transparent', flex: 'none' }}>
        <div style={{ position: 'absolute', top: 2, left: onv ? 20 : 2, width: 10, height: 10, background: onv ? nc : 'rgba(217,218,240,.5)', transition: 'left .15s' }} />
      </div>
    );
    const dash = '1px dashed rgba(217,218,240,.15)';

    // 모바일은 하단 시트, 데스크톱은 dc.html 위치
    const sheetStyle = (side: 'left' | 'right', w: number): React.CSSProperties => mobile
      ? { zoom: K, position: 'absolute', left: 0, right: 0, bottom: 'calc(50px + var(--sab))', maxHeight: `calc(62vh / ${K})`, overflow: 'auto', background: 'rgba(6,7,13,.97)', borderTop: `1px solid ${accentLine}`, boxShadow: `0 0 30px ${glowSoft}`, fontSize: 12, zIndex: 20, touchAction: 'pan-y' }
      : { zoom: K, position: 'absolute', [side]: side === 'left' ? 84 : 14, top: 'calc(66px + var(--sat))', width: w, maxHeight: 'calc(100% - 140px)', overflow: 'auto', background: 'rgba(6,7,13,.95)', border: `1px solid ${accentLine}`, boxShadow: `0 0 30px ${glowSoft}`, fontSize: 12, touchAction: 'pan-y' };

    const settings = s.settingsOpen && (
      <div data-ui="1" onPointerDown={stop} onDoubleClick={stop} style={sheetStyle('left', 300)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${accentLine}`, letterSpacing: '.16em', fontSize: 11, color: nc }}>
          <span>SETTINGS / 설정</span><span style={{ cursor: 'pointer', padding: touch ? '4px 8px' : 0 }} onClick={() => this.setState({ settingsOpen: false })}>✕</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>강조색 1 — 상자</span><span style={{ color: nc }}>{colorName(nc)}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 6 }}>{swatches(PALETTE, nc, hex => this.setPref({ nodeColor: hex }))}</div>
          </div>
          <div onClick={() => this.setPref({ linked: !P.linked })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: dash, borderBottom: dash, cursor: 'pointer' }}>
            <span>연결선 색을 상자와 동일하게</span>{toggle(P.linked)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: P.linked ? 0.35 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>강조색 2 — 연결선</span><span style={{ color: ec }}>{colorName(ec)}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 6 }}>{swatches(PALETTE, P.linked ? null : P.edgeColor, hex => this.setPref({ edgeColor: hex, linked: false }))}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: dash, paddingTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>펜 색상</span><span style={{ color: P.penColor }}>{colorName(P.penColor)}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 6 }}>{swatches(PENS, P.penColor, hex => this.setPref({ penColor: hex }), 22, false)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 6 }}><span>펜 굵기</span><span style={{ color: nc }}>{P.penWidth}px</span></div>
            <input type="range" min={1} max={14} value={P.penWidth} onChange={e => this.setPref({ penWidth: +e.target.value })} style={{ width: '100%', accentColor: nc }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: dash, paddingTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><span>노이즈 / 그레인</span><span style={{ color: nc }}>{P.grain}%</span></div>
            <input type="range" min={0} max={45} value={P.grain} onChange={e => this.setPref({ grain: +e.target.value })} style={{ width: '100%', accentColor: nc }} />
          </div>
          <div onClick={() => this.setPref({ pulse: !P.pulse })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <span>신호 펄스 (뉴런 발화)</span>{toggle(P.pulse)}
          </div>
          <React.Suspense fallback={null}><SyncPanel sync={this.sync} nc={nc} touch={touch} initialCode={s.pairCode} onCodeUsed={this.clearPairCode} onWipeLocal={this.wipeLocal} onRestoreBackup={this.restoreBackup} /></React.Suspense>
          <div onClick={() => this.setState({ licensesOpen: true })} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: dash, paddingTop: 14, minHeight: 30, fontSize: 11, color: 'rgba(217,218,240,.6)', cursor: 'pointer' }}>
            <span>오픈소스 라이선스</span><span style={{ color: nc }}>›</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed rgba(255,156,143,.35)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: '.16em', color: '#FF9C8F' }}>DANGER / 위험 동작</div>
            <button onClick={() => this.setState({ clearOpen: true })} style={{ height: 34, background: 'transparent', color: '#FF9C8F', border: '1px solid rgba(255,156,143,.5)', cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", fontSize: 12 }}>이 카테고리 비우기</button>
          </div>
        </div>
      </div>
    );

    const F = (label: string, title: string, kind: string, x: { w?: number; i?: boolean; s?: boolean } = {}) => (
      <button key={kind} className="hv-fmt" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); this.fmt(kind); }} title={title}
        style={{ height: 30, background: 'transparent', color: '#E9EAF7', border: '1px solid rgba(217,218,240,.2)', cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", fontSize: 12, fontWeight: x.w || 400, fontStyle: x.i ? 'italic' : 'normal', textDecoration: x.s ? 'line-through' : 'none' }}>{label}</button>
    );
    const editLabel = s.editing && single && s.editing === single.id ? '편집 완료' : '편집 ENTER';
    const actions = (
      <div style={{ display: 'flex', gap: 6 }}>
        {single && single.type === 'text' && (
          <button onClick={() => { if (s.editing === single.id) this.setState({ editing: null }); else this.startEdit(single.id); }} style={{ flex: 1, height: 34, background: 'transparent', color: nc, border: `1px solid ${nc}`, cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", fontSize: 12 }}>{touch && editLabel === '편집 ENTER' ? '편집' : editLabel}</button>
        )}
        <button onClick={() => this.deleteSel()} style={{ flex: 1, height: 34, background: 'transparent', color: '#FF9C8F', border: '1px solid rgba(255,156,143,.5)', cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", fontSize: 12 }}>{touch ? '삭제' : '삭제 DEL'}</button>
      </div>
    );
    const panelTitle = single ? (single.type === 'image' ? 'IMAGE' : 'TEXT') : selBoxes.length + ' SELECTED';
    const sheetCollapsed = mobile && !s.sheetOpen;
    const properties = selBoxes.length > 0 && !(mobile && (s.settingsOpen || kbOpen)) && (
      <div data-ui="1" onPointerDown={stop} onDoubleClick={stop} style={sheetStyle('right', 260)}>
        <div onClick={mobile ? () => this.setState({ sheetOpen: !s.sheetOpen }) : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${accentLine}`, letterSpacing: '.16em', fontSize: 11, color: nc, cursor: mobile ? 'pointer' : undefined }}>
          <span>PROPERTIES</span><span>{panelTitle}{mobile ? (s.sheetOpen ? '  ▾' : '  ▴') : ''}</span>
        </div>
        {sheetCollapsed ? <div style={{ padding: 10 }}>{actions}</div> : (
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {single && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: 'rgba(217,218,240,.12)', border: '1px solid rgba(217,218,240,.12)', fontFamily: "'GalmuriMono9',monospace", fontSize: 10 }}>
                {(['X', 'Y', 'W', 'H'] as const).map(k => (
                  <div key={k} style={{ background: '#07080E', padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ color: 'rgba(217,218,240,.45)' }}>{k}</span><span style={{ color: '#E9EAF7' }}>{Math.round(single[k.toLowerCase() as 'x' | 'y' | 'w' | 'h'])}</span></div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(217,218,240,.6)' }}><span>헤더 채우기</span><span style={{ color: curHead || 'rgba(217,218,240,.6)' }}>{curHead === undefined ? '혼합' : curHead ? colorName(curHead) : '없음'}</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 4 }}>
                {[{ name: '없음', hex: null as string | null }, ...PALETTE].map(p => (
                  <button key={p.hex || 'none'} onClick={() => setHead(p.hex)} title={p.name} style={{ height: 22, background: p.hex || 'transparent', border: p.hex ? 'none' : '1px dashed rgba(217,218,240,.35)', outline: curHead === p.hex ? '1px solid #fff' : '1px solid transparent', outlineOffset: 2, cursor: 'pointer', color: 'rgba(217,218,240,.6)', fontSize: 10, padding: 0 }}>{p.hex ? '' : '∅'}</button>
                ))}
              </div>
            </div>
            {single && single.type === 'text' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)' }}>서식 — Markdown</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 4 }}>
                  {[F('B', '볼드', 'bold', { w: 700 }), F('I', '기울임', 'italic', { i: true }), F('S', '취소선', 'strike', { s: true }), F('H1', '제목', 'h1'), F('H2', '소제목', 'h2'),
                    F('•', '글머리표 목록', 'ul'), F('1.', '번호 목록', 'ol'), F('☐', '체크 항목', 'check'), F('❝', '인용문', 'quote'), F('<>', '인라인 코드', 'code')]}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(217,218,240,.6)' }}><span>연결</span><span>{single ? panelLinks.length + ' LINKS' : ''}</span></div>
              {panelLinks.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', border: '1px solid rgba(217,218,240,.12)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><span style={{ width: 6, height: 6, flex: 'none', background: ec }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(byId[l.a === single!.id ? l.b : l.a])}</span></span>
                  <span onClick={() => this.unlink(l.id)} title="연결 해제" style={{ cursor: 'pointer', color: 'rgba(217,218,240,.5)', flex: 'none', padding: touch ? '2px 6px' : 0 }}>✕</span>
                </div>
              ))}
              {(single ? panelLinks.length === 0 : selBoxes.length !== 2) && (
                <div style={{ fontSize: 11, color: 'rgba(217,218,240,.35)' }}>{single ? (touch ? '연결 없음 — LINK 도구 또는 길게 눌러 두 상자 선택' : '연결 없음 — LINK 도구 또는 Shift로 두 상자 선택') : (touch ? '길게 눌러 두 상자를 선택하면 연결할 수 있어요' : 'Shift로 두 상자를 선택하면 연결할 수 있어요')}</div>
              )}
              {selBoxes.length === 2 && !pairLinked && (
                <button onClick={() => this.addLink(s.sel[0], s.sel[1])} style={{ height: 34, background: ec, color: '#05060B', border: 'none', cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", fontSize: 12 }}>⟜ 두 상자 연결</button>
              )}
            </div>
            {actions}
          </div>
        )}
      </div>
    );

    const toolBtn = (key: string, glyph: string, label: string, title: string, run: () => void, on: boolean) => (
      <button key={key} className="hv-ghost" onClick={run} title={title} style={{ width: mobile ? undefined : 58, flex: mobile ? 1 : undefined, minWidth: 0, height: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, background: on ? nc : 'transparent', color: on ? '#05060B' : '#D9DAF0', border: 'none', [mobile ? 'borderRight' : 'borderBottom']: '1px solid rgba(217,218,240,.1)', cursor: 'pointer', fontFamily: "'GalmuriMono11',monospace", padding: 0 }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>{glyph}</span>
        <span style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 8.5, letterSpacing: '.1em' }}>{label}</span>
      </button>
    );
    const tools = [
      toolBtn('select', '↖', 'SELECT', '선택 (V)', () => this.setTool('select'), s.tool === 'select' && !s.space),
      toolBtn('pan', '✥', 'PAN', '화면 이동 (H / Space)', () => this.setTool('pan'), s.tool === 'pan' || s.space),
      toolBtn('text', 'T', 'TEXT', '글 상자 (T)', () => this.setTool('text'), s.tool === 'text'),
      toolBtn('img', '▣', 'IMAGE', '사진 첨부 (I)', () => this.fileRef.current?.click(), false),
      toolBtn('draw', '✎', 'DRAW', '그리기 (P)', () => this.setTool('draw'), s.tool === 'draw'),
      toolBtn('connect', '⟜', 'LINK', '상자 연결 (C)', () => this.setTool('connect'), s.tool === 'connect'),
      toolBtn('undo', '↶', 'UNDO', '실행 취소 (Ctrl/⌘+Z)', () => this.undo(), false),
      toolBtn('set', '⚙', 'SET', '설정', () => this.setState({ settingsOpen: !s.settingsOpen }), s.settingsOpen),
    ];

    const navBtn: React.CSSProperties = { padding: mobile ? '10px 12px' : '10px 14px', background: 'transparent', color: '#D9DAF0', border: 'none', borderRight: '1px solid rgba(217,218,240,.12)', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: 12 };
    const helpGroups = touch ? HELP_TOUCH : HELP_DESKTOP;
    const topBtn: React.CSSProperties = { whiteSpace: 'nowrap', flex: 'none', fontFamily: "'GalmuriMono11',monospace", fontSize: 11, letterSpacing: '.08em', padding: '7px 11px', background: 'transparent', color: '#D9DAF0', border: '1px solid rgba(217,218,240,.25)', cursor: 'pointer' };
    const saveColor = s.saveErr ? '#FF9C8F' : ec;
    const syncColor = s.syncStatus === 'OFFLINE' || s.syncStatus === 'REVOKED' ? '#FF9C8F' : s.syncStatus === 'SYNCING…' || s.syncStatus === 'WAITING' ? 'rgba(217,218,240,.6)' : nc;

    return (
      <div className={'root' + (s.wco ? ' wco' : '')} style={{ position: 'fixed', inset: 0, background: '#050509', overflow: 'hidden', cursor, userSelect: 'none', WebkitUserSelect: 'none', fontFamily: "'GalmuriMono11','Galmuri11',monospace", color: '#D9DAF0', touchAction: 'none' }}
        onPointerDown={e => this.onBgDown(e)}
        onContextMenu={e => {
          // 캔버스에서는 브라우저 메뉴를 막는다(우클릭 = 카테고리 전환). 입력칸·패널에서는 그대로 두되, 우클릭 드래그가 패널 위에서 끝난 경우는 막음
          const t = e.target as Element;
          if (this.lastPT !== 'mouse' || Date.now() - this.swipeEndAt < 400 || !t.closest('[data-ui], textarea, input')) e.preventDefault();
        }}
        onDoubleClick={e => { if (this.lastPT === 'touch' || s.tool !== 'select' || s.space) return; const w = this.toWorld(e.clientX, e.clientY); this.createText(w.x, w.y); }}>
        <div style={{ position: 'absolute', width: '62vw', height: '62vw', left: '-18vw', top: '-24vw', borderRadius: '50%', background: nc, filter: 'blur(90px)', opacity: 0.2, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: '55vw', height: '55vw', right: '-20vw', bottom: '-26vw', borderRadius: '50%', background: ec, filter: 'blur(100px)', opacity: 0.18, pointerEvents: 'none' }} />
        {SHOW_GRID && <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(220,222,255,.10) 1px, transparent 1.2px)', backgroundSize: `${g}px ${g}px`, backgroundPosition: `${v.x}px ${v.y}px`, pointerEvents: 'none' }} />}

        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${s.swipe * 0.35}px)`, opacity: Math.max(0.35, 1 - swAbs / 500), transition: s.swipe ? 'none' : 'transform .2s ease-out, opacity .2s', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${v.x}px, ${v.y}px) scale(${ze})`, transformOrigin: '0 0', pointerEvents: 'auto' }}>
            {this.linksSvg(ec, c, boxes)}
            {boxes.map((b, i) => this.renderBox(b, i, nc, ec, ze))}
          </div>
        </div>

        <canvas ref={this.noiseRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: P.grain / 100, filter: 'blur(0.6px)', mixBlendMode: 'screen' }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg, rgba(0,0,0,.22) 0px, rgba(0,0,0,.22) 1px, transparent 1px, transparent 3px)' }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,.75) 100%)' }} />

        {swAbs > 30 && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
            <div style={{ fontFamily: "'GalmuriMono11',monospace", fontSize: 13, letterSpacing: '.2em', color: nc }}>{(sd > 0 ? 'NEXT → ' : '← PREV ') + (target ? target.name.toUpperCase() : '')}</div>
            <div style={{ width: 180, height: 3, background: 'rgba(217,218,240,.12)' }}><div style={{ height: 3, width: Math.min(100, (swAbs / MOUSE_SWIPE) * 100) + '%', background: nc, boxShadow: `0 0 10px ${nc}` }} /></div>
          </div>
        )}
        <div style={{ position: 'absolute', left: '50%', top: '46%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', opacity: s.flashOn ? 1 : 0, transition: 'opacity .6s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 11, letterSpacing: '.3em', color: nc }}>{s.flash ? String(s.flash.idx + 1).padStart(2, '0') + ' / ' + String(n).padStart(2, '0') : ''}</div>
          <div style={{ fontFamily: "'Galmuri11',monospace", fontSize: 44, color: '#EDEEFA', textShadow: `0 0 24px ${rgba(nc, 0.6)}`, whiteSpace: 'nowrap' }}>{s.flash ? s.flash.name : ''}</div>
        </div>

        {/* 상단 바 — Windows 앱(window-controls-overlay)에서는 타이틀바 자리까지 이어진다 */}
        <div data-ui="1" className="topbar" onPointerDown={stop} onDoubleClick={stop} style={{ zoom: K, position: 'absolute', display: 'flex', alignItems: 'center', gap: mobile ? 10 : 18, background: 'transparent' }}>
          <div className="drag" style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11, letterSpacing: '.18em', color: nc, flex: 'none', alignSelf: 'stretch' }}>
            <span style={{ width: 8, height: 8, background: nc, boxShadow: `0 0 10px ${nc}` }} />{!mobile && <>PIXIEMAP<span style={{ fontSize: 10, letterSpacing: '.06em', color: 'rgba(217,218,240,.42)', marginLeft: 3 }}>생각을 잇는 로파이 마인드맵</span></>}
          </div>
          <div data-tabs="1" className="nodrag" style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', touchAction: 'pan-x' }}>
            {cs.map((t, i) => {
              const on = t.id === c.id, renaming = s.renaming === t.id;
              return (
                <div key={t.id} draggable={!renaming && !touch}
                  onDragStart={e => { this.dragTab = t.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', t.id); } catch { /* 무시 */ } }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const from = this.dragTab; this.dragTab = null; if (from) this.moveCat(from, t.id); }}
                  onClick={() => {
                    // 터치에서는 같은 탭을 두 번 탭 = 이름 변경 (마우스는 더블클릭)
                    const now = Date.now(), l = this.lastTabTap;
                    this.lastTabTap = { t: now, id: t.id };
                    if (this.lastPT === 'touch' && l && l.id === t.id && now - l.t < 400) { this.snapshot(); this.focusRename = true; this.setState({ renaming: t.id }); return; }
                    this.switchTo(t.id);
                  }}
                  onDoubleClick={e => { e.stopPropagation(); if (this.lastPT === 'touch') return; this.snapshot(); this.focusRename = true; this.setState({ renaming: t.id }); }}
                  style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', background: on ? nc : 'transparent', color: on ? '#05060B' : '#D9DAF0', border: `1px solid ${on ? nc : 'rgba(217,218,240,.16)'}`, boxShadow: on ? `0 0 16px ${rgba(nc, 0.5)}` : 'none' }}>
                  <span style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 9, opacity: 0.7 }}>{String(i + 1).padStart(2, '0')}</span>
                  {renaming ? (
                    <>
                      {touch && <span onPointerDown={e => { e.preventDefault(); e.stopPropagation(); this.nudgeCat(t.id, -1); }} onClick={stop} style={{ fontSize: 12, padding: '0 4px' }}>◂</span>}
                      <input data-rename="1" value={t.name}
                        onChange={e => { const val = e.target.value; this.setData(dd => ({ ...dd, cats: dd.cats.map(x => (x.id === t.id ? { ...x, name: val } : x)) }), false); }}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                        onBlur={() => this.setState({ renaming: null })} onClick={stop}
                        style={{ width: textW(t.name), background: 'transparent', border: 'none', borderBottom: '1px dashed currentColor', color: 'inherit', fontFamily: "'GalmuriMono11',monospace", fontSize: 12, padding: 0, borderRadius: 0 }} />
                      {touch && <span onPointerDown={e => { e.preventDefault(); e.stopPropagation(); this.nudgeCat(t.id, 1); }} onClick={stop} style={{ fontSize: 12, padding: '0 4px' }}>▸</span>}
                    </>
                  ) : <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{t.name}</span>}
                </div>
              );
            })}
          </div>
          <div className="nodrag" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>
            <div title={s.saveStatus} style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 10, letterSpacing: '.12em', color: saveColor, display: 'flex', gap: 6, alignItems: 'center', marginRight: mobile ? 0 : 6, whiteSpace: 'nowrap', flex: 'none' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: saveColor, boxShadow: `0 0 8px ${saveColor}` }} />{mobile && !s.saveErr ? '' : s.saveStatus}
            </div>
            {s.syncStatus !== 'off' && (
              <div title="동기화 상태" style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 10, letterSpacing: '.12em', color: syncColor, display: 'flex', gap: 6, alignItems: 'center', marginRight: mobile ? 0 : 6, whiteSpace: 'nowrap', flex: 'none', cursor: 'pointer' }} onClick={() => this.setState({ settingsOpen: true })}>
                <span style={{ width: 6, height: 6, background: syncColor, boxShadow: `0 0 8px ${syncColor}` }} />{mobile ? '' : s.syncStatus}
              </div>
            )}
            <button className="hv-outline" onClick={() => this.doExport()} title="EXPORT — 백업 파일 만들기" style={topBtn}>{mobile ? '↓' : 'EXPORT ↓'}</button>
            <button className="hv-outline" onClick={() => this.importRef.current?.click()} title="IMPORT — 백업 파일 불러오기" style={topBtn}>{mobile ? '↑' : 'IMPORT ↑'}</button>
          </div>
        </div>

        {/* 툴바 — 데스크톱은 좌측 세로, 모바일은 하단 가로 */}
        {!(mobile && kbOpen) && (
          <div data-ui="1" onPointerDown={stop} onDoubleClick={stop} style={mobile
            ? { zoom: K, position: 'absolute', left: 0, right: 0, bottom: 'var(--sab)', display: 'flex', background: 'rgba(6,7,13,.94)', borderTop: `1px solid ${accentLine}`, boxShadow: `0 0 24px ${glowSoft}`, zIndex: 21 }
            : { zoom: K, position: 'absolute', left: 'calc(14px + var(--sal))', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', background: 'rgba(6,7,13,.9)', border: `1px solid ${accentLine}`, boxShadow: `0 0 24px ${glowSoft}` }}>
            {tools}
          </div>
        )}

        {settings}
        {properties}

        {!(mobile && (kbOpen || s.settingsOpen || (selBoxes.length > 0 && s.sheetOpen))) && (
          <div data-ui="1" onPointerDown={stop} onDoubleClick={stop} style={{ zoom: K, position: 'absolute', left: '50%', bottom: mobile ? (selBoxes.length ? 'calc(50px + 100px + var(--sab))' :'calc(50px + 10px + var(--sab))') : 'calc(16px + var(--sab))', transform: 'translateX(-50%)', display: 'flex', alignItems: 'stretch', border: `1px solid ${accentLine}`, background: 'rgba(6,7,13,.9)', boxShadow: `0 0 24px ${glowSoft}`, fontFamily: "'GalmuriMono11',monospace", fontSize: 12, whiteSpace: 'nowrap' }}>
            <button className="hv-ghost" onClick={() => this.go(-1)} style={navBtn}>{mobile ? '‹' : '‹ PREV'}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: mobile ? '0 10px' : '0 16px', minWidth: mobile ? 96 : 130, justifyContent: 'center', borderRight: '1px solid rgba(217,218,240,.12)' }}><span style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 9, color: nc }}>{String(idx + 1).padStart(2, '0') + '/' + String(n).padStart(2, '0')}</span><span style={{ color: '#EDEEFA', maxWidth: mobile ? 90 : 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span></div>
            <button className="hv-ghost" onClick={() => this.go(1)} style={navBtn}>{mobile ? '›' : 'NEXT ›'}</button>
            <button className="hv-ghost" onClick={() => this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, v.z / 1.2)} style={{ ...navBtn, width: 38, padding: 0, borderRight: 'none', fontSize: 15 }}>−</button>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, fontFamily: "'GalmuriMono9',monospace", fontSize: 10, color: nc }}>{Math.round(v.z * 100)}%</div>
            <button className="hv-ghost" onClick={() => this.zoomAt(window.innerWidth / 2, window.innerHeight / 2, v.z * 1.2)} style={{ ...navBtn, width: 38, padding: 0, fontSize: 15 }}>+</button>
            <button className="hv-ghost" onClick={() => this.fit()} style={navBtn}>{compact ? '⛶' : '⛶ 전체 보기'}</button>
            <button onClick={() => this.setState({ helpOpen: !s.helpOpen })} style={{ ...navBtn, borderRight: 'none', background: s.helpOpen ? nc : 'transparent', color: s.helpOpen ? '#05060B' : '#D9DAF0' }}>{compact ? '?' : '? 안내'}</button>
          </div>
        )}

        {s.tool === 'connect' && (
          <div style={{ zoom: K, position: 'absolute', left: '50%', top: 'calc(78px + var(--sat))', transform: 'translateX(-50%)', padding: '8px 14px', border: `1px dashed ${ec}`, background: 'rgba(6,7,13,.9)', color: ec, fontSize: 11, letterSpacing: '.08em', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
            {s.connectFrom ? (touch ? '연결할 두 번째 상자를 누르세요' : '연결할 두 번째 상자를 누르세요 · ESC 취소') : 'LINK — 연결할 첫 번째 상자를 누르세요'}
          </div>
        )}

        {s.iosHint && (
          <div data-ui="1" onPointerDown={stop} style={{ zoom: K, position: 'absolute', left: '50%', top: 'calc(66px + var(--sat))', transform: 'translateX(-50%)', width: 'min(360px, calc(100vw / 0.85 - 32px))', padding: '12px 14px', border: `1px dashed ${nc}`, background: 'rgba(6,7,13,.95)', boxShadow: `0 0 24px ${glowSoft}`, fontSize: 11, lineHeight: 1.6, display: 'flex', gap: 10, alignItems: 'flex-start', zIndex: 30 }}>
            <span style={{ color: nc, flex: 'none' }}>⬆</span>
            <span style={{ flex: 1 }}>홈 화면에 추가하면 앱처럼 전체 화면으로 쓸 수 있어요.<br /><span style={{ color: 'rgba(217,218,240,.6)' }}>Safari 하단의 공유 버튼 → ‘홈 화면에 추가’</span></span>
            <span onClick={() => this.dismissIosHint()} style={{ cursor: 'pointer', padding: '0 4px', color: 'rgba(217,218,240,.6)' }}>✕</span>
          </div>
        )}

        {s.helpOpen && (
          <div data-ui="1" onPointerDown={e => { e.stopPropagation(); this.setState({ helpOpen: false }); }} onDoubleClick={stop} style={{ position: 'absolute', inset: 0, background: 'rgba(3,3,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 40 }}>
            <div onPointerDown={stop} style={{ zoom: K, width: 'min(720px,100%)', maxHeight: '100%', overflow: 'auto', background: 'rgba(6,7,13,.97)', border: `1px solid ${accentLine}`, boxShadow: `0 0 40px ${glowSoft}`, touchAction: 'pan-y' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${accentLine}`, fontSize: 11, letterSpacing: '.16em', color: nc }}><span>{touch ? 'GESTURES / 제스처 안내' : 'MANUAL / 사용 안내'}</span><span style={{ cursor: 'pointer', padding: touch ? '0 6px' : 0 }} onClick={() => this.setState({ helpOpen: false })}>✕</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 1, background: 'rgba(217,218,240,.1)' }}>
                {helpGroups.map(gr => (
                  <div key={gr.title} style={{ background: '#07080E', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontFamily: "'GalmuriMono9',monospace", fontSize: 10, letterSpacing: '.16em', color: nc }}>{gr.title}</div>
                    {gr.items.map(it => (
                      <div key={it.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, lineHeight: 1.4 }}><span style={{ color: '#E9EAF7' }}>{it.k}</span><span style={{ color: 'rgba(217,218,240,.55)', textAlign: 'right' }}>{it.v}</span></div>
                    ))}
                  </div>
                ))}
              </div>
              <div onClick={() => this.setState({ helpOpen: false, licensesOpen: true })} style={{ padding: '10px 16px', fontSize: 10.5, color: 'rgba(217,218,240,.5)', cursor: 'pointer', textAlign: 'right' }}>오픈소스 라이선스 ›</div>
            </div>
          </div>
        )}

        {s.clearOpen && (() => {
          const cc = this.cat, nb = liveBoxes(cc).length, nl = liveLinks(cc).length, ns = liveStrokes(cc).length;
          const danger = '#FF9C8F';
          const cbtn = (label: string, onClick: () => void, kind: 'fill' | 'line' | 'ghost', disabled = false) => (
            <button disabled={disabled} onClick={onClick} style={{ flex: 1, minWidth: 0, height: touch ? 44 : 34, padding: '0 8px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, fontFamily: "'GalmuriMono11',monospace", fontSize: 12,
              background: kind === 'fill' ? danger : 'transparent', color: kind === 'fill' ? '#05060B' : kind === 'line' ? danger : 'rgba(217,218,240,.7)', border: kind === 'fill' ? 'none' : kind === 'line' ? '1px solid rgba(255,156,143,.5)' : '1px solid rgba(217,218,240,.2)' }}>{label}</button>
          );
          return (
            <div data-ui="1" onPointerDown={e => { e.stopPropagation(); this.setState({ clearOpen: false }); }} onDoubleClick={stop} style={{ position: 'absolute', inset: 0, background: 'rgba(3,3,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 42 }}>
              <div role="dialog" aria-label="이 카테고리 비우기" onPointerDown={stop} style={{ zoom: K, width: 'min(400px,100%)', background: 'rgba(6,7,13,.97)', border: '1px solid rgba(255,156,143,.45)', boxShadow: '0 0 40px rgba(255,156,143,.12)' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,156,143,.3)', fontSize: 11, letterSpacing: '.16em', color: danger }}>CLEAR / 이 카테고리 비우기</div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 13, color: '#EDEEFA' }}>‘{cc.name}’</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'rgba(217,218,240,.1)', border: '1px solid rgba(217,218,240,.1)' }}>
                    {([['상자', nb], ['연결선', nl], ['펜 획', ns]] as const).map(([k, n]) => (
                      <div key={k} style={{ background: '#07080E', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 10, color: 'rgba(217,218,240,.55)' }}>{k}</span>
                        <span style={{ fontFamily: "'GalmuriMono11',monospace", fontSize: 16, color: n ? '#EDEEFA' : 'rgba(217,218,240,.35)' }}>{n}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)', lineHeight: 1.6 }}>카테고리 이름과 탭은 남습니다. 동기화 중이면 다른 기기에서도 지워집니다. 실행 취소(Ctrl/⌘+Z 또는 UNDO)로 한 번에 되돌릴 수 있어요.</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {cbtn('전부 지우기', () => this.clearCat('all'), 'fill', nb + nl + ns === 0)}
                    {cbtn('펜 획만 지우기', () => this.clearCat('strokes'), 'line', ns === 0)}
                    {cbtn('취소', () => this.setState({ clearOpen: false }), 'ghost')}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {s.joinAsk && (() => {
          const j = s.joinAsk, m = j.mine, close = () => this.setState({ joinAsk: null });
          const jbtn = (label: string, onClick: () => void, kind: 'fill' | 'line' | 'ghost', auto = false) => (
            <button autoFocus={auto} disabled={s.joinBusy} onClick={onClick} style={{ flex: 1, minWidth: 0, height: touch ? 44 : 34, padding: '0 8px', cursor: s.joinBusy ? 'default' : 'pointer', opacity: s.joinBusy ? 0.5 : 1, fontFamily: "'GalmuriMono11',monospace", fontSize: 12,
              background: kind === 'fill' ? nc : 'transparent', color: kind === 'fill' ? '#05060B' : kind === 'line' ? nc : 'rgba(217,218,240,.7)', border: kind === 'fill' ? 'none' : kind === 'line' ? `1px solid ${accentLine}` : '1px solid rgba(217,218,240,.2)' }}>{label}</button>
          );
          const grid = (cells: [string, number][]) => (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length},1fr)`, gap: 1, background: 'rgba(217,218,240,.1)', border: '1px solid rgba(217,218,240,.1)' }}>
              {cells.map(([k, n]) => (
                <div key={k} style={{ background: '#07080E', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 10, color: 'rgba(217,218,240,.55)' }}>{k}</span>
                  <span style={{ fontFamily: "'GalmuriMono11',monospace", fontSize: 16, color: n ? '#EDEEFA' : 'rgba(217,218,240,.35)' }}>{n}</span>
                </div>
              ))}
            </div>
          );
          const label = (t: string) => <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)' }}>{t}</div>;
          return (
            <div data-ui="1" onPointerDown={e => { e.stopPropagation(); if (!s.joinBusy) close(); }} onDoubleClick={stop} style={{ position: 'absolute', inset: 0, background: 'rgba(3,3,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 43 }}>
              <div role="dialog" aria-label="이 기기에서 만든 내용이 있어요" onPointerDown={stop} style={{ zoom: K, width: 'min(420px,100%)', background: 'rgba(6,7,13,.97)', border: `1px solid ${accentLine}`, boxShadow: `0 0 40px ${glowSoft}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderBottom: `1px solid ${accentLine}`, fontSize: 11, letterSpacing: '.16em', color: nc }}>
                  <span>이 기기에서 만든 내용이 있어요</span>
                  <span style={{ cursor: 'pointer', padding: touch ? '0 6px' : 0 }} onClick={() => { if (!s.joinBusy) close(); }}>✕</span>
                </div>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {s.joinStep === 'ask' ? (<>
                    {label('이 기기에만 있는 것')}
                    {grid([['카테고리', m.cats], ['상자', m.boxes], ['연결선', m.links], ['펜 획', m.strokes]])}
                    {m.newer > 0 && <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)' }}>이 기기에서 더 최근에 고친 항목 {m.newer}개</div>}
                    {label('계정에 있는 것')}
                    {grid([['카테고리', j.account.cats], ['상자', j.account.boxes]])}
                    <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)', lineHeight: 1.6 }}>고르기 전까지는 이 기기 내용을 서버에 올리지 않아요. 창을 닫으면 다음에 앱을 열 때 다시 물어요.</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {jbtn('계정에 추가하기 (기본)', () => this.joinAdd(), 'fill', true)}
                      {jbtn('계정 내용만 불러오기', () => this.setState({ joinStep: 'confirm', joinErr: null }), 'line')}
                    </div>
                  </>) : (<>
                    <div style={{ fontSize: 13, color: '#EDEEFA', lineHeight: 1.6 }}>이 기기에서 만든 내용은 백업해두고 계정 내용으로 바꿔요</div>
                    <div style={{ fontSize: 11, color: 'rgba(217,218,240,.6)', lineHeight: 1.6 }}>백업은 이 기기에만 저장되고(사진 포함, 최근 3개) 30일 뒤 자동으로 지워져요. 설정 › 동기화 › 이전 기기 데이터 복구에서 계정에 다시 더할 수 있어요.</div>
                    {s.joinErr && <div style={{ fontSize: 11, color: '#FF9C8F' }}>{s.joinErr}</div>}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {jbtn(s.joinBusy ? '백업하는 중…' : '백업하고 바꾸기', () => this.joinReplace(), 'fill', true)}
                      {jbtn('뒤로', () => this.setState({ joinStep: 'ask', joinErr: null }), 'ghost')}
                    </div>
                  </>)}
                </div>
              </div>
            </div>
          );
        })()}

        {s.toast && (
          <div role="status" style={{ position: 'absolute', left: '50%', bottom: mobile ? 150 : 90, transform: 'translateX(-50%)', zIndex: 44, pointerEvents: 'none', padding: '8px 14px', background: 'rgba(6,7,13,.95)', border: `1px solid ${accentLine}`, color: '#EDEEFA', fontFamily: "'GalmuriMono11',monospace", fontSize: 12, whiteSpace: 'nowrap', boxShadow: `0 0 24px ${glowSoft}` }}>{s.toast}</div>
        )}

        {s.licensesOpen && (
          <div data-ui="1" onPointerDown={e => { e.stopPropagation(); this.setState({ licensesOpen: false }); }} onDoubleClick={stop} style={{ position: 'absolute', inset: 0, background: 'rgba(3,3,6,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 41 }}>
            <div onPointerDown={stop} onWheel={e => e.stopPropagation()} style={{ zoom: K, width: 'min(640px,100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', background: 'rgba(6,7,13,.97)', border: `1px solid ${accentLine}`, boxShadow: `0 0 40px ${glowSoft}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${accentLine}`, fontSize: 11, letterSpacing: '.16em', color: nc, flex: 'none' }}><span>LICENSES / 오픈소스 라이선스</span><span style={{ cursor: 'pointer', padding: touch ? '0 6px' : 0 }} onClick={() => this.setState({ licensesOpen: false })}>✕</span></div>
              <div data-scroll="1" style={{ overflow: 'auto', minHeight: 0, touchAction: 'pan-y' }}>
                <React.Suspense fallback={null}><Licenses nc={nc} /></React.Suspense>
              </div>
            </div>
          </div>
        )}

        {/* 사진: accept=image/* 만 지정 → iOS/안드로이드에서 사진 보관함·카메라·파일 중 선택 */}
        <input ref={this.fileRef} type="file" accept="image/*" multiple onChange={e => { const f = [...(e.target.files || [])]; if (f.length) this.addImages(f); e.target.value = ''; }} style={{ display: 'none' }} />
        <input ref={this.importRef} type="file" accept=".json,application/json" onChange={e => { const f = e.target.files?.[0]; if (f) this.doImport(f); e.target.value = ''; }} style={{ display: 'none' }} />
      </div>
    );
  }
}
