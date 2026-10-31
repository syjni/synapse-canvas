// 먼지 입자 한 개의 움직임 (소개 페이지). 화면 그리기와 떼어 두어 테스트할 수 있게 한다.
// 입자는 기본 흐름(x·y, 아주 느린 속도)과 커서에 밀린 어긋남(ox·oy)을 따로 가진다.
// 어긋남은 스프링 + 강한 감쇠로 원래 흐름에 돌아온다 → 튕기지 않고 감속하며 복귀.
export type Dust = { x: number; y: number; vx: number; vy: number; ox: number; oy: number; ovx: number; ovy: number };

export const DUST = {
  R: 120,         // 커서가 밀어내는 반경(px)
  PUSH: 0.9,      // 밀어내는 세기
  SPRING: 0.0025, // 원래 흐름으로 돌아오는 힘 (작을수록 천천히. 약 0.5초에 걸쳐 복귀)
  DAMP: 0.9,      // 프레임마다 남는 속도 비율
  // 튕기지 않으려면 (1 + DAMP − DAMP·SPRING)² ≥ 4·DAMP (과감쇠). 0.9·0.0025면 만족 (테스트로 확인)
};

// dt: 60fps 한 프레임 = 1. px·py: 커서 위치(없으면 화면 밖 아주 먼 곳)
export function stepDust(p: Dust, px: number, py: number, dt: number, W: number, H: number, rand = Math.random) {
  p.x += p.vx * dt; p.y += p.vy * dt;
  if (p.y < -10) { p.y = H + 10; p.x = rand() * W; }
  if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
  const dx = p.x + p.ox - px, dy = p.y + p.oy - py, d = Math.hypot(dx, dy);
  if (d < DUST.R && d > 0.01) {
    const f = (1 - d / DUST.R) ** 2 * DUST.PUSH;   // 가까울수록 세게, 커서 반대 방향으로
    p.ovx += (dx / d) * f * dt; p.ovy += (dy / d) * f * dt;
  }
  const keep = DUST.DAMP ** dt;
  p.ovx = (p.ovx - p.ox * DUST.SPRING * dt) * keep;
  p.ovy = (p.ovy - p.oy * DUST.SPRING * dt) * keep;
  p.ox += p.ovx * dt; p.oy += p.ovy * dt;
}
