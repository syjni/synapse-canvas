// 화면 확대·축소 계산 (Canvas와 테스트가 함께 쓴다)
export type View = { x: number; y: number; z: number };

export const Z_MIN = 0.2, Z_MAX = 3;
export const WHEEL_CAP = 1.15;     // 이벤트 하나로 바뀌는 배율 상한 (축소는 1/1.15)
export const BUTTON_STEP = 1.2;    // 하단 +/− 버튼
export const ZOOM_TAU = 40;        // 목표 배율을 따라가는 속도(ms). 약 120ms(3τ)면 95% 도달

export const clampZ = (z: number) => Math.max(Z_MIN, Math.min(Z_MAX, z));

// 줄·페이지 단위(일부 마우스·Firefox)는 픽셀로 환산
export const wheelPixels = (delta: number, mode: number, pageH: number) => delta * (mode === 1 ? 16 : mode === 2 ? pageH : 1);

// Ctrl/⌘ + 휠 한 번의 배율. 트랙패드 오므리기(이벤트당 수 px)는 지금처럼 비례하고,
// 마우스 휠 한 칸(100px 안팎)은 상한에 걸려 10~15%만 바뀐다
export function wheelZoomFactor(px: number) {
  return Math.max(1 / WHEEL_CAP, Math.min(WHEEL_CAP, Math.exp(-px * 0.01)));
}

// 마우스 휠의 '한 칸'인지(→ 부드럽게 따라가기), 트랙패드처럼 잘게 이어지는 입력인지(→ 바로 반영)
export const isWheelNotch = (px: number, mode: number) => mode !== 0 || Math.abs(px) >= 40;

// (cx, cy) 화면 지점 아래의 캔버스 지점이 그대로 있도록 배율을 z로
export function zoomView(v: View, cx: number, cy: number, z: number): View {
  z = clampZ(z);
  const k = z / v.z;
  return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}

// 목표 배율로 다가가는 한 프레임 (배율 공간이 아니라 로그 공간에서 지수적으로 → 확대·축소 속도가 같게 느껴짐)
// 다 왔으면 목표값 그대로 돌려준다
export function approachZoom(z: number, target: number, dt: number) {
  const a = Math.log(z), b = Math.log(target);
  if (Math.abs(b - a) < 0.002) return target;
  return Math.exp(b + (a - b) * Math.exp(-dt / ZOOM_TAU));
}
