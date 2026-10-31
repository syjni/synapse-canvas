// 마우스로 누른 곳·버튼·도구에 따라 어떤 동작을 시작할지 정한다 (Canvas의 포인터 처리와 테스트가 함께 쓴다).
// 우선순위: 리사이즈 핸들 > 우클릭 카테고리 전환 > 도구별 동작. 터치·펜은 Canvas에서 따로 처리한다.
export type Tool = 'select' | 'pan' | 'text' | 'draw' | 'connect';
export type Part = 'resize' | 'handle' | 'body' | 'bg';
export type Action =
  | 'resize'      // 상자 크기 조절
  | 'move'        // 헤더를 잡고 상자 이동
  | 'select'      // 상자 클릭 = 선택
  | 'connect'     // 연결 도구: 상자 클릭
  | 'swipe'       // 우클릭 드래그 = 카테고리 전환
  | 'pan'         // 바로 화면 이동 (가운데 버튼·Space·PAN 도구)
  | 'click-pan'   // 3px 넘게 끌면 화면 이동, 아니면 클릭(선택 해제)
  | 'draw' | 'text' | 'connect-cancel'
  | 'ignore'      // 아무것도 하지 않음(이벤트는 여기서 끝)
  | 'bubble';     // 상자가 처리하지 않고 배경으로 넘김

export function mouseAction(p: { part: Part; button: number; tool: Tool; space: boolean }): Action {
  const { part, button, tool, space } = p;
  if (part === 'resize') return button === 0 ? 'resize' : 'ignore';   // 핸들은 도구와 상관없이 크기 조절만
  if (button === 2) return part === 'bg' ? 'swipe' : 'bubble';
  if (part !== 'bg') {
    if (space || tool === 'pan' || tool === 'draw' || tool === 'text') return 'bubble';
    if (tool === 'connect') return button === 0 ? 'connect' : 'ignore';
    if (button !== 0) return 'ignore';
    return part === 'handle' ? 'move' : 'select';
  }
  if (button === 1 || (button === 0 && (space || tool === 'pan'))) return 'pan';
  if (button !== 0) return 'ignore';
  if (tool === 'draw') return 'draw';
  if (tool === 'text') return 'text';
  if (tool === 'connect') return 'connect-cancel';
  return 'click-pan';
}

// ── PAN 도구 더블클릭 → 글 상자 ─────────────────────
// PAN 도구는 누르는 순간부터 화면 이동이라 브라우저 dblclick(끈 뒤에도 발생)을 쓰지 않고 누름·뗌으로 직접 판정한다.
// 두 클릭의 뗀 시각 간격 ≤ 300ms, 누른 위치 차이 ≤ 6px, 두 번 모두 누른 동안 3px 미만으로 움직였을 때만.
export const DBL_CLICK_MS = 300, DBL_CLICK_DIST = 6, CLICK_MOVE = 3;
// Space를 누른 임시 이동·가운데 버튼은 제외
export const panDoubleClickable = (p: { tool: Tool; space: boolean; button: number }) => p.tool === 'pan' && !p.space && p.button === 0;

export class DoubleClick {
  private last: { t: number; x: number; y: number } | null = null;
  // 클릭(pointerup)마다 호출. x·y는 누른 위치, moved는 누른 동안 가장 멀리 움직인 거리. 더블클릭이면 true
  up(c: { t: number; x: number; y: number; moved: number }): boolean {
    if (c.moved >= CLICK_MOVE) { this.last = null; return false; }   // 화면을 끌어 옮긴 클릭은 세지 않고, 다음 클릭부터 새로
    const l = this.last;
    if (l && c.t - l.t <= DBL_CLICK_MS && Math.hypot(c.x - l.x, c.y - l.y) <= DBL_CLICK_DIST) { this.last = null; return true; }
    this.last = { t: c.t, x: c.x, y: c.y };
    return false;
  }
  reset() { this.last = null; }
}
