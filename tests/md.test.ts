import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { md, insertTable, hasTable, tableHeadLabel, tableCell, setTableCell, tableSize, tableOp, fillTable, parseSheet, tableIndexAt } from '../src/lib/md';

const AC = '#88AAFF';
const count = (html: string, s: string) => html.split(s).length - 1;
// 칸 안의 글: <td style=...><div style=...>글</div></td>
const cellsOf = (html: string, tag: 'th' | 'td') => [...html.matchAll(new RegExp(`<${tag} [^>]*><div[^>]*>(.*?)</div></${tag}>`, 'g'))].map(m => m[1]);
const cellDiv = (html: string, text: string) => html.match(new RegExp(`<div style="([^"]*)">${text}</div>`))?.[1];

describe('md 표', () => {
  it('머리글·구분 줄·본문을 표로 그린다', () => {
    const h = md('| 이름 | 값 |\n| --- | --- |\n| a | 1 |\n| b | 2 |', AC);
    expect(count(h, '<table')).toBe(1);
    expect(cellsOf(h, 'th')).toEqual(['이름', '값']);
    expect(cellsOf(h, 'td')).toEqual(['a', '1', 'b', '2']);
  });

  it('양 끝의 |가 없어도 표다', () => {
    expect(md('a | b\n--- | ---\n1 | 2', AC)).toContain('<table');
  });

  it('구분 줄의 콜론으로 정렬한다', () => {
    const h = md('| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |', AC);
    expect(h).toMatch(/text-align:left[^>]*><div[^>]*>1</);
    expect(h).toMatch(/text-align:center[^>]*><div[^>]*>2</);
    expect(h).toMatch(/text-align:right[^>]*><div[^>]*>3</);
  });

  it('머리글에만 열을 추가해도 표가 유지된다', () => {
    const h = md('| 이름 | 값 | 비고 |\n| --- | --- |\n| a | 1 |', AC);
    expect(cellsOf(h, 'th')).toEqual(['이름', '값', '비고']);
    expect(cellsOf(h, 'td')).toEqual(['a', '1', '']);
  });

  it('본문에만 칸을 더 써도 글이 사라지지 않는다', () => {
    const h = md('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |', AC);
    expect(cellsOf(h, 'th')).toEqual(['a', 'b', '']);
    expect(cellsOf(h, 'td')).toEqual(['1', '', '', '1', '2', '3']);
  });

  it('칸 안의 서식을 적용하고 \\|는 글자로 둔다', () => {
    const h = md('| a |\n| - |\n| **굵게** x\\|y |', AC);
    expect(h).toContain('<strong');
    expect(h).toContain('x|y');
  });

  it('칸 안의 HTML은 이스케이프한다', () => {
    const h = md('| <img src=x onerror=alert(1)> |\n| --- |\n| <script> |', AC);
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<script');
  });

  it('표가 아닌 글은 그대로다', () => {
    expect(md('a | b\n---', AC)).not.toContain('<table');            // 구분 줄에 |가 없음 → 구분선
    expect(md('a | b', AC)).not.toContain('<table');
    expect(md('a | b\n글 | 글', AC)).not.toContain('<table');         // 구분 줄이 아님
    expect(md('```\n| a |\n| - |\n```', AC)).not.toContain('<table'); // 코드 블록 안
  });

  it('|가 없는 줄이나 빈 줄에서 표가 끝난다', () => {
    const h = md('| a |\n| - |\n| 1 |\n끝\n| 2 |', AC);
    expect(cellsOf(h, 'td')).toEqual(['1']);
    expect(h).toContain('>끝</div>');
  });

  it('날짜·숫자는 칸 안에서 쪼개지 않는다', () => {
    const h = md('| 날짜 | 금액 |\n| - | - |\n| 2026-11-04 | 2100000 |', AC);
    expect(cellDiv(h, '2026-11-04')).toContain('white-space:nowrap');
    expect(cellDiv(h, '2100000')).toContain('white-space:nowrap');
    expect(h).toContain('overflow-wrap:normal');
  });

  it('아주 긴 낱말은 칸 안에서 줄을 바꾼다', () => {
    const long = 'a'.repeat(40);
    expect(cellDiv(md(`| x |\n| - |\n| ${long} |`, AC), long)).toContain('overflow-wrap:anywhere');
  });

  it('표는 가로로 스크롤되는 영역에 들어간다', () => {
    expect(md('| a |\n| - |', AC)).toMatch(/<div data-xscroll="1"[^>]*overflow:auto hidden[^>]*><table/);
  });

  it('구형 Safari에서 번들을 깨뜨리는 뒤보기 정규식을 쓰지 않는다', () => {
    expect(readFileSync('src/lib/md.ts', 'utf8')).not.toMatch(/\(\?<[!=]/);
  });
});

describe('표 고치기', () => {
  const T = '글\n\n| a | b |\n| :-- | --: |\n| 1 | 2 |\n| 3 | 4 |\n\n끝';
  const grid = (text: string, t = 0) => {
    const s = tableSize(text, t)!;
    return Array.from({ length: s.rows }, (_, r) => Array.from({ length: s.cols }, (_, c) => tableCell(text, t, r, c)));
  };

  it('칸마다 위치가 표시된다 (머리글이 0번 줄)', () => {
    const h = md('| x |\n| - |\n\n| a | b |\n| - | - |\n| 1 | 2 |', AC);
    expect(h).toContain('data-cell="0:0:0"');
    expect(h).toContain('data-cell="1:0:1"');
    expect(h).toContain('data-cell="1:1:1"');
  });

  it('칸을 읽고 쓴다. 표 밖의 글과 정렬은 그대로', () => {
    expect(tableCell(T, 0, 1, 1)).toBe('2');
    const r = setTableCell(T, 0, 1, 1, '새 값');
    expect(grid(r)).toEqual([['a', 'b'], ['1', '새 값'], ['3', '4']]);
    expect(r.startsWith('글\n\n')).toBe(true);
    expect(r.endsWith('\n\n끝')).toBe(true);
    expect(r).toContain('| :-- | --: |');
  });

  it('칸에 쓴 |와 줄바꿈이 표를 깨지 않는다', () => {
    const r = setTableCell(T, 0, 0, 0, 'x|y\nz');
    expect(tableCell(r, 0, 0, 0)).toBe('x|y z');
    expect(tableSize(r, 0)).toEqual({ rows: 3, cols: 2 });
    expect(r).toContain('x\\|y z');
  });

  it('이미 있던 \\|도 다른 칸을 고칠 때 그대로 남는다', () => {
    const r = setTableCell('| a\\|b | c |\n| - | - |', 0, 0, 1, 'd');
    expect(tableCell(r, 0, 0, 0)).toBe('a|b');
    expect(tableSize(r, 0)).toEqual({ rows: 1, cols: 2 });
  });

  it('여러 표 중 고른 표만 고친다', () => {
    const two = '| a |\n| - |\n\n| b |\n| - |';
    const r = setTableCell(two, 1, 0, 0, 'x');
    expect(tableCell(r, 0, 0, 0)).toBe('a');
    expect(tableCell(r, 1, 0, 0)).toBe('x');
  });

  it('행을 추가한다', () => {
    const below = tableOp(T, 0, 'rowBelow', 1, 1);
    expect(grid(below.text)).toEqual([['a', 'b'], ['1', '2'], ['', ''], ['3', '4']]);
    expect([below.r, below.c]).toEqual([2, 1]);
    const above = tableOp(T, 0, 'rowAbove', 2, 0);
    expect(grid(above.text)).toEqual([['a', 'b'], ['1', '2'], ['', ''], ['3', '4']]);
    expect(above.r).toBe(2);
  });

  it('머리글 위에는 행이 생기지 않고 바로 아래에 들어간다', () => {
    const r = tableOp(T, 0, 'rowAbove', 0, 0);
    expect(grid(r.text)).toEqual([['a', 'b'], ['', ''], ['1', '2'], ['3', '4']]);
    expect(r.r).toBe(1);
  });

  it('열을 추가해도 기존 정렬이 제자리에 남는다', () => {
    const r = tableOp(T, 0, 'colRight', 1, 0);
    expect(grid(r.text)).toEqual([['a', '', 'b'], ['1', '', '2'], ['3', '', '4']]);
    expect(r.text).toContain('| :-- | --- | --: |');
    expect([r.r, r.c]).toEqual([1, 1]);
    const l = tableOp(T, 0, 'colLeft', 1, 0);
    expect(grid(l.text)).toEqual([['', 'a', 'b'], ['', '1', '2'], ['', '3', '4']]);
    expect(l.text).toContain('| --- | :-- | --: |');
  });

  it('행·열을 지운다', () => {
    const row = tableOp(T, 0, 'rowDel', 2, 0);
    expect(grid(row.text)).toEqual([['a', 'b'], ['1', '2']]);
    expect(row.r).toBe(1);
    const col = tableOp(T, 0, 'colDel', 0, 1);
    expect(grid(col.text)).toEqual([['a'], ['1'], ['3']]);
    expect(col.c).toBe(0);
    expect(col.text).toContain('| :-- |');
  });

  it('머리글 행을 지우면 다음 줄이 머리글이 된다', () => {
    expect(grid(tableOp(T, 0, 'rowDel', 0, 0).text)).toEqual([['1', '2'], ['3', '4']]);
  });

  it('마지막 행·열이나 표 삭제는 표를 없애고 다음 글을 남긴다', () => {
    const one = '앞\n\n| a |\n| - |\n\n뒤';
    for (const op of ['rowDel', 'colDel', 'tableDel'] as const) {
      const r = tableOp(one, 0, op, 0, 0);
      expect(r.r).toBe(-1);
      expect(r.text).toBe('앞\n\n뒤');
    }
    expect(tableOp('| a |\n| - |', 0, 'tableDel', 0, 0).text).toBe('');
  });

  it('복사한 칸을 지금 칸부터 채우고 모자라면 늘린다', () => {
    const r = fillTable(T, 0, 2, 1, [['x', 'y'], ['z', 'w']]);
    expect(grid(r)).toEqual([['a', 'b', ''], ['1', '2', ''], ['3', 'x', 'y'], ['', 'z', 'w']]);
  });

  it('글자 위치로 몇 번째 표인지 찾는다', () => {
    const two = '| a |\n| - |\n\n글\n\n| b |\n| - |';
    expect(tableIndexAt(two, 2)).toBe(0);
    expect(tableIndexAt(two, two.indexOf('글'))).toBe(-1);
    expect(tableIndexAt(two, two.indexOf('b'))).toBe(1);
  });
});

describe('parseSheet', () => {
  it('엑셀에서 복사한 칸을 푼다 (끝 줄바꿈·CRLF)', () => {
    expect(parseSheet('품목\t수량\r\n사과\t3\r\n')).toEqual([['품목', '수량'], ['사과', '3']]);
  });

  it('따옴표로 묶인 칸의 줄바꿈과 큰따옴표를 처리한다', () => {
    expect(parseSheet('"첫줄\n둘째줄"\t"그는 ""네""라고"\na\tb')).toEqual([['첫줄 둘째줄', '그는 "네"라고'], ['a', 'b']]);
  });

  it('빈 칸을 지키고 끝이 빈 칸인 줄도 유지한다', () => {
    expect(parseSheet('a\t\tc\nd\te\t')).toEqual([['a', '', 'c'], ['d', 'e', '']]);
  });

  it('탭이 든 일반 글은 표로 보지 않는다', () => {
    expect(parseSheet('그냥 글')).toBe(null);
    expect(parseSheet('한 줄\t탭')).toBe(null);
    expect(parseSheet('\tfoo\n\tbar')).toBe(null);              // 들여쓴 코드
    expect(parseSheet('a\tb\nc')).toBe(null);                   // 칸 수가 다름
  });

  it('스프레드시트(HTML 표 있음)면 한 줄이어도 표다', () => {
    expect(parseSheet('a\tb', true)).toEqual([['a', 'b']]);
    expect(parseSheet('a\tb\nc', true)).toEqual([['a', 'b'], ['c', '']]);
    expect(parseSheet('한 칸', true)).toBe(null);
  });

  it('붙여넣은 내용으로 표를 만든다', () => {
    const r = insertTable('', 0, 0, 0, [['이름', 'x|y'], ['a', '']]);
    expect(cellsOf(md(r.text, AC), 'th')).toEqual(['이름', 'x|y']);
    expect(r.text.slice(r.start, r.end)).toBe('이름');
  });
});

describe('hasTable · tableHeadLabel', () => {
  it('표가 있는지 안다 (코드 블록 안은 제외)', () => {
    expect(hasTable('글\n\n| a |\n| - |')).toBe(true);
    expect(hasTable('글')).toBe(false);
    expect(hasTable('```\n| a |\n| - |\n```')).toBe(false);
  });

  it('글이 표로 시작하면 머리글을 이름으로 쓴다', () => {
    expect(tableHeadLabel('\n| 번호 | 내용 |\n| --- | --- |')).toBe('번호 · 내용');
    expect(tableHeadLabel('제목\n\n| a |\n| - |')).toBe(null);
    expect(tableHeadLabel('|   |   |\n| - | - |')).toBe('');
    expect(tableHeadLabel('')).toBe(null);
  });
});

describe('insertTable', () => {
  const rendered = (text: string) => md(text, AC);

  it('빈 상자에 넣으면 첫 머리글이 선택된다', () => {
    const r = insertTable('', 0);
    expect(r.text.slice(r.start, r.end)).toBe('A');
    expect(r.text.startsWith('| A |')).toBe(true);
    expect(count(rendered(r.text), '<th ')).toBe(3);
    expect(count(rendered(r.text), '<td ')).toBe(6);
  });

  it('고른 크기대로 만든다 (줄 수는 머리글 포함)', () => {
    const r = insertTable('', 0, 5, 4);
    const h = rendered(r.text);
    expect(cellsOf(h, 'th')).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(count(h, '<td ')).toBe(15);
    expect(r.text.slice(r.start, r.end)).toBe('A');
    const one = rendered(insertTable('', 0, 1, 1).text);
    expect(cellsOf(one, 'th')).toEqual(['A']);
    expect(count(one, '<td ')).toBe(0);
    expect(cellsOf(rendered(insertTable('', 0, 8, 6).text), 'th')).toHaveLength(8);
  });

  it('줄 가운데에 커서가 있어도 그 줄을 자르지 않고 다음에 넣는다', () => {
    const r = insertTable('첫 줄\n둘째 줄', 1);
    expect(r.text.startsWith('첫 줄\n\n| A |')).toBe(true);
    expect(r.text.endsWith('|\n\n둘째 줄')).toBe(true);
    expect(r.text.slice(r.start, r.end)).toBe('A');
  });

  it('바로 앞뒤의 표와 섞이지 않는다', () => {
    const old = '| x |\n| - |\n| 1 |';
    const before = insertTable(old, old.length);                      // 기존 표 뒤
    expect(count(rendered(before.text), '<table')).toBe(2);
    const after = insertTable('글\n' + old, 0);                        // 기존 표 앞
    expect(count(rendered(after.text), '<table')).toBe(2);
  });

  it('표 안에 커서가 있으면 그 표를 쪼개지 않고 뒤에 넣는다', () => {
    const old = '| a |\n| - |\n| 1 |\n| 2 |';
    const r = insertTable(old + '\n끝', old.indexOf('| 1 |') + 2);
    expect(r.text.startsWith(old + '\n\n| A |')).toBe(true);
    expect(r.text.endsWith('|\n\n끝')).toBe(true);
    expect(cellsOf(rendered(r.text), 'td').slice(0, 2)).toEqual(['1', '2']);
    expect(r.text.slice(r.start, r.end)).toBe('A');
  });

  it('코드 블록 안에 커서가 있으면 블록이 끝난 뒤에 넣는다', () => {
    const code = '```\ncode\n```';
    const r = insertTable(code, 5);
    expect(r.text.startsWith(code + '\n\n| A |')).toBe(true);
    expect(count(rendered(r.text), '<table')).toBe(1);
  });

  it('닫히지 않은 코드 블록은 닫고 그 뒤에 넣는다', () => {
    for (const code of ['```\ncode', '```', '글\n```\ncode\n더']) {
      const r = insertTable(code, code.length);
      expect(r.text.startsWith(code + '\n```\n\n| A |')).toBe(true);
      expect(count(rendered(r.text), '<table')).toBe(1);
      expect(r.text.slice(r.start, r.end)).toBe('A');
    }
    const mid = '```\none\ntwo';
    expect(insertTable(mid, 5).text.startsWith(mid + '\n```\n\n| A |')).toBe(true);
  });

  it('이미 빈 줄이 있으면 더 넣지 않는다', () => {
    expect(insertTable('글\n\n', 3).text).toBe('글\n\n| A | B | C |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |');
    expect(insertTable('글\n\n끝', 0).text.endsWith('|\n\n끝')).toBe(true);
  });
});
