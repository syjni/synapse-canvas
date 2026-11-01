import { describe, it, expect } from 'vitest';
import { wheelPixels, wheelZoomFactor, isWheelNotch, zoomView, approachZoom, clampZ, WHEEL_CAP, Z_MIN, Z_MAX, type View } from '../src/lib/zoom';

const H = 900;
const factor = (deltaY: number, mode = 0) => wheelZoomFactor(wheelPixels(deltaY, mode, H));
// 화면 지점 (cx, cy) 아래의 캔버스 좌표
const world = (v: View, cx: number, cy: number) => ({ x: (cx - v.x) / v.z, y: (cy - v.y) / v.z });

// 실제 Canvas처럼 휠 한 칸 = 목표만 바꾸고, 16ms 프레임마다 따라간다
function animate(v: View, cx: number, cy: number, target: number, ms: number) {
  let z = v.z;
  for (let t = 0; t < ms; t += 16) { z = approachZoom(z, target, 16); v = zoomView(v, cx, cy, z); }
  return v;
}

describe('Ctrl/⌘ + 휠 확대 배율', () => {
  it.each([[100, 0], [120, 0], [3, 1], [-100, 0], [-120, 0], [-3, 1]])('휠 한 칸 deltaY=%d, deltaMode=%d → 1.15배 이하', (dy, mode) => {
    const f = factor(dy, mode);
    expect(Math.max(f, 1 / f)).toBeLessThanOrEqual(WHEEL_CAP + 1e-9);
    expect(Math.max(f, 1 / f)).toBeGreaterThan(1.1);     // 너무 둔하지도 않게 (10~15%)
    expect(isWheelNotch(wheelPixels(dy, mode, H), mode)).toBe(true);
  });
  it('줄 단위(deltaMode 1)는 ×16, 페이지 단위(2)는 화면 높이로 환산', () => {
    expect(wheelPixels(3, 1, H)).toBe(48);
    expect(wheelPixels(1, 2, H)).toBe(H);
    expect(wheelPixels(7.5, 0, H)).toBe(7.5);
  });
  it('57%에서 휠 두 칸이면 300%로 튀지 않고 75% 남짓', () => {
    const z = 0.57 * factor(-100) * factor(-100);
    expect(z).toBeLessThan(0.57 * WHEEL_CAP ** 2 + 1e-9);
    expect(z).toBeGreaterThan(0.7);
  });
  it('트랙패드 오므리기(deltaY 2~10 연속)는 예전 공식 exp(-deltaY·0.01) 그대로', () => {
    for (const dy of [2, 3.5, 5, 7, 10, -2, -6, -10]) {
      expect(factor(dy)).toBeCloseTo(Math.exp(-dy * 0.01), 12);
      expect(isWheelNotch(dy, 0)).toBe(false);
    }
    // 연속 30번 오므리면 예전과 같은 만큼 (상한 때문에 둔해지지 않음)
    let z = 1, old = 1;
    for (let i = 0; i < 30; i++) { const dy = 2 + (i % 9); z *= factor(-dy); old *= Math.exp(dy * 0.01); }
    expect(z).toBeCloseTo(old, 10);
  });
  it('범위는 20%~300%', () => {
    expect(clampZ(0.01)).toBe(Z_MIN);
    expect(clampZ(99)).toBe(Z_MAX);
    expect(zoomView({ x: 0, y: 0, z: 2.9 }, 10, 10, 2.9 * 1.15).z).toBe(Z_MAX);
  });
});

describe('부드럽게 따라가기', () => {
  it('약 120ms 안에 목표의 95% 이상, 그 뒤 정확히 목표값에서 멈춤', () => {
    let z = 1;
    for (let t = 0; t < 120; t += 16) z = approachZoom(z, 1.15, 16);
    expect(Math.log(z) / Math.log(1.15)).toBeGreaterThan(0.95);
    for (let t = 0; t < 200; t += 16) z = approachZoom(z, 1.15, 16);
    expect(z).toBe(1.15);
  });
  it('첫 프레임에 한 번에 점프하지 않는다', () => {
    const z = approachZoom(1, 1.15, 16);
    expect(z).toBeGreaterThan(1);
    expect(z).toBeLessThan(1.1);
  });
  it('빠르게 여러 칸 굴리면 목표가 쌓인다 (애니메이션 중 다음 칸)', () => {
    let target = 1, z = 1;
    for (let notch = 0; notch < 4; notch++) {
      target = clampZ(target * factor(-100));
      for (let t = 0; t < 32; t += 16) z = approachZoom(z, target, 16);   // 칸 사이 32ms
    }
    expect(target).toBeCloseTo(WHEEL_CAP ** 4, 10);
    for (let t = 0; t < 400; t += 16) z = approachZoom(z, target, 16);
    expect(z).toBe(target);
  });
});

describe('커서 기준점', () => {
  it('zoomView는 커서 아래 캔버스 지점을 그대로 둔다', () => {
    const v = { x: 120, y: -40, z: 0.57 }, c = [640, 360] as const;
    const before = world(v, ...c), after = world(zoomView(v, ...c, 1.3), ...c);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
  it('애니메이션의 모든 프레임에서 커서 아래 지점이 고정', () => {
    let v: View = { x: 300, y: 200, z: 0.57 }, z = v.z;
    const c = [812, 433] as const, p0 = world(v, ...c);
    for (let t = 0; t < 300; t += 16) {
      z = approachZoom(z, 0.57 * WHEEL_CAP, 16); v = zoomView(v, ...c, z);
      const p = world(v, ...c);
      expect(p.x).toBeCloseTo(p0.x, 9); expect(p.y).toBeCloseTo(p0.y, 9);
    }
    expect(animate(v, ...c, 0.57 * WHEEL_CAP, 100).z).toBeCloseTo(0.57 * WHEEL_CAP, 12);
  });
});
