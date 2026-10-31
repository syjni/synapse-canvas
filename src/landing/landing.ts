// 소개 페이지 효과: 떠다니는 먼지 입자 + 스크롤하면 떠오르기. 글은 모두 정적 HTML이고 이 스크립트는 그 위에 얹는 효과다.
import { oklchHex } from '../lib/color';
import { stepDust, type Dust } from './dust';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── 스크롤하면 천천히 떠오르기 ──────────────────────
const rise = document.querySelectorAll<HTMLElement>('.rise');
if (reduce || !('IntersectionObserver' in window)) rise.forEach(el => el.classList.add('on'));
else {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
  rise.forEach(el => io.observe(el));
}

// ── 먼지 입자 ────────────────────────────────────────
type P = Dust & { r: number; a: number; hl: boolean; tw: number };
const cv = document.getElementById('dust') as HTMLCanvasElement | null;
const ctx = cv?.getContext('2d');

if (cv && ctx) {
  let W = 0, H = 0, dpr = 1, ps: P[] = [], raf = 0, last = 0;
  let px = -1e4, py = -1e4;   // 커서(또는 손가락) 위치. 없으면 화면 밖
  let hue = 0, hlColor = '#6DB6FF', hueAt = 0;

  const make = (): P => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.08, vy: -0.02 - Math.random() * 0.07,   // 아주 천천히, 대체로 위로
    ox: 0, oy: 0, ovx: 0, ovy: 0,
    r: 0.5 + Math.random() * 0.6, a: 0.12 + Math.random() * 0.35, hl: Math.random() < 0.14, tw: Math.random() * Math.PI * 2,
  });
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 화면 넓이에 맞춰 입자 수 조절 (성능 유지: 최대 260개)
    const n = Math.max(50, Math.min(260, Math.round((W * H) / 7000)));
    while (ps.length < n) ps.push(make());
    ps.length = n;
  };
  // 강조색은 CSS의 --h(60초에 한 바퀴)를 읽어 맞춘다. 줄여 보기 설정이면 블루 고정
  const readHue = (t: number) => {
    if (reduce || t - hueAt < 400) return;
    hueAt = t;
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--h'));
    if (!Number.isNaN(h) && Math.abs(h - hue) > 0.5) { hue = h; hlColor = oklchHex(0.76, 0.13, h); }
  };

  const draw = (t: number) => {
    ctx.clearRect(0, 0, W, H);
    for (const p of ps) {
      const x = p.x + p.ox, y = p.y + p.oy;
      const tw = reduce ? 1 : 0.75 + 0.25 * Math.sin(t * 0.0006 + p.tw);
      const c = p.hl ? hlColor : '#DADBEF';
      // 흐릿한 테두리(큰 원, 옅게) + 심(작은 원)
      ctx.globalAlpha = p.a * tw * 0.35; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, p.r * 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = p.a * tw;
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const step = (t: number) => {
    const dt = Math.min(3, last ? (t - last) / 16.7 : 1); last = t;
    readHue(t);
    for (const p of ps) stepDust(p, px, py, dt, W, H);
    draw(t);
    raf = requestAnimationFrame(step);
  };
  const start = () => { if (!raf && !reduce && !document.hidden) { last = 0; raf = requestAnimationFrame(step); } };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  resize();
  if (reduce) draw(0);   // 움직임 줄이기: 멈춘 상태로 한 번만 그린다
  else {
    // 첫 화면 로딩을 막지 않도록 브라우저가 한가할 때 시작
    const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(start, { timeout: 600 }); else setTimeout(start, 200);
    addEventListener('pointermove', e => { if (e.pointerType !== 'touch') { px = e.clientX; py = e.clientY; } }, { passive: true });
    document.addEventListener('pointerleave', () => { px = py = -1e4; });
    addEventListener('blur', () => { px = py = -1e4; });
    // 터치: 손가락을 대고 움직이는 위치를 커서처럼 (스크롤은 막지 않음)
    const touch = (e: TouchEvent) => { const t = e.touches[0]; if (t) { px = t.clientX; py = t.clientY; } };
    addEventListener('touchstart', touch, { passive: true });
    addEventListener('touchmove', touch, { passive: true });
    addEventListener('touchend', e => { if (!e.touches.length) px = py = -1e4; }, { passive: true });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  }
  addEventListener('resize', () => { resize(); if (reduce) draw(0); });
}
