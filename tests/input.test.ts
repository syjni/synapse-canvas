import { describe, it, expect } from 'vitest';
import { mouseAction, type Tool } from '../src/lib/input';

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
