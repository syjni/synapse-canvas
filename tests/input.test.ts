import { describe, it, expect } from 'vitest';
import { mouseAction, panDoubleClickable, DoubleClick, type Tool } from '../src/lib/input';

const TOOLS: Tool[] = ['select', 'pan', 'text', 'draw', 'connect'];
const at = (part: 'resize' | 'handle' | 'body' | 'bg', button = 0, tool: Tool = 'select', space = false) => mouseAction({ part, button, tool, space });

describe('마우스 입력 우선순위 (서로 가로채지 않기)', () => {
  it('리사이즈 핸들 좌클릭은 도구·Space와 상관없이 항상 크기 조절', () => {
    for (const t of TOOLS) for (const sp of [false, true]) expect(at('resize', 0, t, sp)).toBe('resize');
  });
  it('리사이즈 핸들에서는 우클릭·가운데 버튼도 다른 동작(전환·이동)으로 새지 않는다', () => {
    for (const t of TOOLS) { expect(at('resize', 2, t)).toBe('ignore'); expect(at('resize', 1, t)).toBe('ignore'); }
  });
  it('헤더 좌클릭(SELECT) = 상자 이동, 화면 이동이 아님', () => {
    expect(at('handle')).toBe('move');
    expect(at('body')).toBe('select');
  });
  it('빈 곳 좌클릭(SELECT) = 클릭/화면 이동, PAN 도구·Space·가운데 버튼 = 바로 화면 이동', () => {
    expect(at('bg')).toBe('click-pan');
    expect(at('bg', 0, 'pan')).toBe('pan');
    expect(at('bg', 0, 'select', true)).toBe('pan');
    expect(at('bg', 1, 'draw')).toBe('pan');
  });
  it('우클릭은 빈 곳·상자 위 모두 카테고리 전환 (상자는 배경으로 넘김)', () => {
    for (const t of TOOLS) {
      expect(at('bg', 2, t)).toBe('swipe');
      expect(at('body', 2, t)).toBe('bubble');
      expect(at('handle', 2, t)).toBe('bubble');
    }
  });
  it('PAN·DRAW·TEXT 도구나 Space에서는 상자 본문·헤더가 배경 동작으로 넘어간다 (핸들만 예외)', () => {
    for (const t of ['pan', 'draw', 'text'] as Tool[]) { expect(at('handle', 0, t)).toBe('bubble'); expect(at('body', 0, t)).toBe('bubble'); }
    expect(at('handle', 0, 'select', true)).toBe('bubble');
    expect(at('bg', 0, 'draw')).toBe('draw');
    expect(at('bg', 0, 'text')).toBe('text');
  });
  it('LINK 도구: 상자 클릭 = 연결, 빈 곳 = 연결 취소', () => {
    expect(at('body', 0, 'connect')).toBe('connect');
    expect(at('handle', 0, 'connect')).toBe('connect');
    expect(at('bg', 0, 'connect')).toBe('connect-cancel');
  });
});

describe('PAN 도구 빈 곳 더블클릭 → 글 상자', () => {
  const click = (t: number, x = 100, y = 100, moved = 0) => ({ t, x, y, moved });
  it('300ms 안에 6px 안에서 움직이지 않은 클릭 두 번 = 더블클릭 (세 번째 클릭은 새로 시작)', () => {
    const d = new DoubleClick();
    expect(d.up(click(0))).toBe(false);
    expect(d.up(click(250, 104, 103))).toBe(true);
    expect(d.up(click(400))).toBe(false);
  });
  it('끌어서 화면을 옮긴 뒤의 클릭은 더블클릭이 아니다', () => {
    const d = new DoubleClick();
    expect(d.up(click(0, 100, 100, 40))).toBe(false);   // 드래그(화면 이동)
    expect(d.up(click(120))).toBe(false);               // 드래그 직후 클릭 = 첫 클릭으로만
    const e = new DoubleClick();
    expect(e.up(click(0))).toBe(false);
    expect(e.up(click(150, 100, 100, 3))).toBe(false);  // 두 번째가 3px 움직임
    expect(e.up(click(300))).toBe(false);
  });
  it('간격 300ms 초과·위치 6px 초과는 아님', () => {
    const d = new DoubleClick();
    d.up(click(0)); expect(d.up(click(301))).toBe(false);
    const e = new DoubleClick();
    e.up(click(0)); expect(e.up(click(100, 107, 100))).toBe(false);
  });
  it('PAN 도구 좌클릭만 해당: Space 임시 이동·가운데 버튼·SELECT 도구는 제외', () => {
    expect(panDoubleClickable({ tool: 'pan', space: false, button: 0 })).toBe(true);
    expect(panDoubleClickable({ tool: 'pan', space: true, button: 0 })).toBe(false);
    expect(panDoubleClickable({ tool: 'pan', space: false, button: 1 })).toBe(false);
    expect(panDoubleClickable({ tool: 'select', space: true, button: 0 })).toBe(false);
  });
  it('SELECT 도구의 빈 곳 좌클릭은 그대로 클릭/화면 이동 (브라우저 dblclick로 생성)', () => {
    expect(at('bg')).toBe('click-pan');
    expect(panDoubleClickable({ tool: 'select', space: false, button: 0 })).toBe(false);
  });
});
