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
