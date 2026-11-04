import { rgba } from './color';

// ── 표 (GFM) ─────────────────────────────────────────
// `\|`는 칸 나누기가 아니라 글자 |. 양 끝의 |는 있어도 없어도 된다.
const tableCells = (line: string) => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (/(^|[^\\])\|$/.test(s)) s = s.slice(0, -1);
  // 뒤보기 정규식은 Safari 16.4 미만에서 번들 전체를 깨뜨리므로 쓰지 않는다
  return s.replace(/\\\|/g, '\0').split('|').map(c => c.trim().replace(/\0/g, '|'));
};
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// 머리글·구분 줄 모두 |를 포함하면 표다 (`---`만 있는 줄은 구분선으로 남는다).
// GFM과 달리 칸 수가 달라도 표로 둔다: 열을 하나씩 고쳐 쓰는 도중에 표 전체가 글자로 돌아가지 않게.
const isTableStart = (head: string, delim: string | undefined) =>
  delim !== undefined && head.includes('|') && delim.includes('|') && TABLE_DELIM.test(delim);
const isFence = (line: string) => /^```/.test(line);
const tableEnd = (lines: string[], start: number) => {
  let end = start + 2;
  while (end < lines.length && lines[end].includes('|')) end++;
  return end - 1;
};

// 코드 블록과 표가 차지하는 줄 범위 (코드 블록 안의 표는 표가 아니다)
function blocks(lines: string[]) {
  const out: { kind: 'code' | 'table'; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    let end = -1, kind: 'code' | 'table' = 'code';
    if (isFence(lines[i])) {
      end = i + 1;
      while (end < lines.length && !isFence(lines[end])) end++;
      end = Math.min(end, lines.length - 1);
    } else if (isTableStart(lines[i], lines[i + 1])) { kind = 'table'; end = tableEnd(lines, i); }
    if (end < 0) continue;
    out.push({ kind, start: i, end });
    i = end;
  }
  return out;
}
export const hasTable = (text: string) => blocks(text.split('\n')).some(b => b.kind === 'table');

// 글이 표로 시작하면 머리글 이름들 (연결 목록의 상자 이름용). 표로 시작하지 않으면 null
export function tableHeadLabel(text: string): string | null {
  const lines = text.split('\n'), i = lines.findIndex(l => l.trim());
  if (i < 0 || !isTableStart(lines[i], lines[i + 1])) return null;
  return tableCells(lines[i]).filter(Boolean).join(' · ');
}

// ── 표 고치기 (칸·행·열) ─────────────────────────────
// t는 글 안에서 몇 번째 표인지, r은 줄(0 = 머리글), c는 열.
const escapeCell = (v: string) => v.replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|');
const tableLine = (cells: string[]) => '| ' + cells.map(c => c || ' ').join(' | ') + ' |';

function readTable(text: string, t: number) {
  const lines = text.split('\n');
  const block = blocks(lines).filter(b => b.kind === 'table')[t];
  if (!block) return null;
  const rows = [lines[block.start], ...lines.slice(block.start + 2, block.end + 1)].map(tableCells);
  const delim = tableCells(lines[block.start + 1]);
  const cols = Math.max(delim.length, ...rows.map(r => r.length));
  return { lines, block, delim, rows: rows.map(r => Array.from({ length: cols }, (_, i) => r[i] ?? '')), cols };
}
type Grid = NonNullable<ReturnType<typeof readTable>>;
// 칸 안의 글은 tableCells가 푼 상태로 들고 있다가 쓸 때 다시 \|로 묶는다
const writeTable = (g: Grid) => {
  const delim = Array.from({ length: g.cols }, (_, i) => g.delim[i] ?? '---');
  const out = [tableLine(g.rows[0].map(escapeCell)), tableLine(delim), ...g.rows.slice(1).map(r => tableLine(r.map(escapeCell)))];
  return [...g.lines.slice(0, g.block.start), ...out, ...g.lines.slice(g.block.end + 1)].join('\n');
};

export function tableSize(text: string, t: number) {
  const g = readTable(text, t);
  return g ? { rows: g.rows.length, cols: g.cols } : null;
}
export const tableCell = (text: string, t: number, r: number, c: number) => readTable(text, t)?.rows[r]?.[c] ?? '';

export function setTableCell(text: string, t: number, r: number, c: number, value: string) {
  const g = readTable(text, t);
  if (!g || !g.rows[r] || c >= g.cols) return text;
  g.rows[r][c] = value;
  return writeTable(g);
}

export type TableOp = 'rowAbove' | 'rowBelow' | 'colLeft' | 'colRight' | 'rowDel' | 'colDel' | 'tableDel';
// 결과의 r·c는 다음에 편집할 칸. 표가 없어지면 r = -1
export function tableOp(text: string, t: number, op: TableOp, r: number, c: number): { text: string; r: number; c: number } {
  const g = readTable(text, t);
  if (!g) return { text, r: -1, c: -1 };
  const removeTable = () => {
    const l = g.lines.slice(), start = g.block.start;
    l.splice(start, g.block.end - start + 1);
    // 표 앞뒤의 빈 줄이 겹치면 하나만 남긴다
    if (start > 0 && start < l.length && !l[start - 1].trim() && !l[start].trim()) l.splice(start, 1);
    return { text: l.join('\n').replace(/^\n+|\n+$/g, ''), r: -1, c: -1 };
  };
  const blank = () => Array.from({ length: g.cols }, () => '');
  const addCol = (at: number) => {
    g.rows.forEach(row => row.splice(at, 0, ''));
    g.delim = Array.from({ length: g.cols }, (_, i) => g.delim[i] ?? '---');
    g.delim.splice(at, 0, '---');
    g.cols++;
  };
  let nr = r, nc = c;
  switch (op) {
    case 'tableDel': return removeTable();
    // 머리글 위에는 넣지 않고(머리글은 맨 윗줄) 머리글 바로 아래에 넣는다
    case 'rowAbove': { const at = Math.max(1, r); g.rows.splice(at, 0, blank()); nr = at; break; }
    case 'rowBelow': g.rows.splice(r + 1, 0, blank()); nr = r + 1; break;
    case 'colLeft': addCol(c); nc = c; break;
    case 'colRight': addCol(c + 1); nc = c + 1; break;
    case 'rowDel':
      if (g.rows.length === 1) return removeTable();
      g.rows.splice(r, 1); nr = Math.min(r, g.rows.length - 1); break;
    case 'colDel':
      if (g.cols === 1) return removeTable();
      g.rows.forEach(row => row.splice(c, 1));
      g.delim = g.delim.filter((_, i) => i !== c);
      g.cols--; nc = Math.min(c, g.cols - 1); break;
  }
  return { text: writeTable(g), r: nr, c: nc };
}

// 복사한 칸들을 (r, c)부터 채운다. 모자라는 줄·열은 늘린다.
export function fillTable(text: string, t: number, r: number, c: number, sheet: string[][]) {
  const g = readTable(text, t);
  if (!g) return text;
  const cols = Math.max(g.cols, c + Math.max(...sheet.map(row => row.length)));
  g.rows.forEach(row => { while (row.length < cols) row.push(''); });
  g.cols = cols;
  sheet.forEach((row, i) => {
    while (g.rows.length <= r + i) g.rows.push(Array.from({ length: cols }, () => ''));
    row.forEach((v, j) => { g.rows[r + i][c + j] = v; });
  });
  return writeTable(g);
}

// 스프레드시트에서 복사한 글(탭으로 나뉜 칸, 큰따옴표로 묶인 칸 안의 줄바꿈)을 칸들로 푼다. 표가 아니면 null.
// fromSheet: 클립보드에 HTML 표도 함께 있을 때(엑셀·구글 시트). 한 줄만 복사해도 표로 본다.
// 그렇지 않으면 글·코드의 탭과 헷갈리지 않게 2줄 이상이고 모든 줄의 칸 수가 같을 때만 표로 본다.
export function parseSheet(clip: string, fromSheet = false): string[][] | null {
  const src = clip.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!src.includes('\t')) return null;
  const rows: string[][] = [[]];
  let i = 0;
  while (i <= src.length) {
    let cell = '';
    if (src[i] === '"') {
      i++;
      while (i < src.length && !(src[i] === '"' && src[i + 1] !== '"')) { if (src[i] === '"') i++; cell += src[i]; i++; }
      i++;
    }
    while (i < src.length && src[i] !== '\t' && src[i] !== '\n') cell += src[i++];
    rows[rows.length - 1].push(cell.replace(/\s*\n\s*/g, ' ').trim());
    if (src[i] === '\n') rows.push([]);
    i++;
  }
  const cols = Math.max(...rows.map(r => r.length));
  if (cols < 2) return null;
  if (!fromSheet && (rows.length < 2 || rows.some(r => r.length !== cols) || rows.every(r => !r[0]))) return null;
  return rows.map(r => Array.from({ length: cols }, (_, j) => r[j] ?? ''));
}

// 글자 위치가 들어 있는 표가 몇 번째인지. 표 밖이면 -1
export function tableIndexAt(text: string, pos: number) {
  const lines = text.split('\n'), cur = text.slice(0, pos).split('\n').length - 1;
  return blocks(lines).filter(b => b.kind === 'table').findIndex(b => b.start <= cur && cur <= b.end);
}

// 커서가 있는 줄 다음에 표를 넣는다. 커서가 표나 코드 블록 안이면 그 블록을 쪼개지 않고 끝난 뒤에 넣는다.
// (닫히지 않은 코드 블록은 끝이 없으니 먼저 닫는다.)
// 앞뒤를 빈 줄로 띄워 이웃한 줄이 표에 섞이지 않게 하고, 첫 머리글을 선택해 바로 고쳐 쓸 수 있게 한다.
// rows는 머리글 줄을 포함한 줄 수. sheet를 주면 그 내용으로 채운다(첫 줄이 머리글).
export function insertTable(text: string, pos: number, cols = 3, rows = 3, sheet?: string[][]): { text: string; start: number; end: number } {
  const lines = text.split('\n'), cur = text.slice(0, pos).split('\n').length - 1;
  const inBlock = blocks(lines).find(b => b.start <= cur && cur <= b.end);
  const at = lines.slice(0, (inBlock ? inBlock.end : cur) + 1).join('\n').length;
  const unclosed = inBlock?.kind === 'code' && (inBlock.end === inBlock.start || !isFence(lines[inBlock.end]));
  const before = text.slice(0, at) + (unclosed ? '\n```' : ''), after = text.slice(at);
  const pre = !before.trim() || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = after && !after.startsWith('\n\n') ? '\n' : '';
  const grid = sheet ?? [Array.from({ length: cols }, (_, i) => String.fromCharCode(65 + i)), ...Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, () => ''))];
  const width = grid[0].length;
  const table = [tableLine(grid[0].map(escapeCell)), tableLine(Array.from({ length: width }, () => '---')), ...grid.slice(1).map(r => tableLine(r.map(escapeCell)))].join('\n');
  const start = before.length + pre.length + 2;
  return { text: before + pre + table + post + after, start, end: start + escapeCell(grid[0][0]).length };
}

// dc.html의 md() 그대로 — HTML 이스케이프 후 변환(XSS 방지) 순서 유지
export function md(src: string, ac: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inl = (s: string) => esc(s)
    .replace(/`([^`]+)`/g, `<code style="background:${rgba(ac, .16)};color:${ac};padding:0 4px;font-family:GalmuriMono11,monospace">$1</code>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff">$1</strong>')
    .replace(/~~(.+?)~~/g, '<s style="opacity:.55">$1</s>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|\s)_([^_]+)_/g, '$1<em>$2</em>');
  const out: string[] = []; let list: string | null = null, code: string[] | null = null;
  const close = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null; } };
  const open = (t: string) => { if (list !== t) { close(); out.push(t === 'ol' ? '<ol style="margin:0 0 6px;padding-left:20px">' : `<ul style="margin:0 0 6px;padding-left:${t === 'chk' ? 0 : 16}px;list-style:${t === 'chk' ? 'none' : 'square'}">`); list = t; } };
  let tableNo = 0;
  const table = (head: string, delim: string, rows: string[]) => {
    const no = tableNo++;
    const headCells = tableCells(head), delimCells = tableCells(delim), bodyCells = rows.map(tableCells);
    // 어느 줄이든 칸이 더 있으면 그만큼 열을 늘린다 (쓴 글이 말없이 사라지지 않게)
    const cols = Math.max(headCells.length, delimCells.length, ...bodyCells.map(r => r.length));
    const align = (i: number) => { const c = delimCells[i] ?? ''; return c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'; };
    // 칸을 글자 단위로 쪼개지 않는다. 날짜·숫자 같은 짧은 낱말은 한 줄로, 너무 좁아지면 표가 넓어지고 가로로 스크롤된다.
    const fit = (raw: string) => (!/\s/.test(raw) ? (raw.length <= 24 ? 'white-space:nowrap' : 'overflow-wrap:anywhere;min-width:12em') : raw.length > 12 ? 'min-width:4em' : '');
    const cell = (tag: string, row: string[], r: number, i: number) => { const raw = row[i] ?? ''; return `<${tag} data-cell="${no}:${r}:${i}" style="border:1px solid ${rgba(ac, .4)};padding:3px 5px;height:20px;box-sizing:border-box;font-weight:400;text-align:${align(i)}${tag === 'th' ? `;color:#fff;background:${rgba(ac, .14)}` : ''}"><div style="${fit(raw)}">${inl(raw)}</div></${tag}>`; };
    const tr = (tag: string, row: string[], r: number) => `<tr>${Array.from({ length: cols }, (_, i) => cell(tag, row, r, i)).join('')}</tr>`;
    return `<div data-xscroll="1" style="overflow:auto hidden;margin:0 0 6px;padding-bottom:1px"><table style="border-collapse:collapse;width:100%;word-break:keep-all;overflow-wrap:normal"><thead>${tr('th', headCells, 0)}</thead><tbody>${bodyCells.map((r, i) => tr('td', r, i + 1)).join('')}</tbody></table></div>`;
  };
  const lines = src.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre style="margin:0 0 6px;padding:7px 9px;background:rgba(0,0,0,.45);border:1px dashed ${rgba(ac, .4)};color:${ac};font-family:GalmuriMono11,monospace;font-size:11px;white-space:pre-wrap">${esc(code.join('\n'))}</pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { close(); code = []; continue; }
    if (isTableStart(line, lines[n + 1])) {
      close();
      const end = tableEnd(lines, n);
      out.push(table(line, lines[n + 1], lines.slice(n + 2, end + 1)));
      n = end;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      close(); const lv = m[1].length;
      const st = lv === 1 ? `font-size:18px;color:#fff;text-shadow:0 0 10px ${rgba(ac, .7)}` : lv === 2 ? 'font-size:15px;color:#F2F2FA' : `font-size:13px;color:${ac};letter-spacing:.04em`;
      out.push(`<div style="${st};margin:0 0 6px;line-height:1.3">${inl(m[2])}</div>`);
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { close(); out.push(`<div style="border-top:1px dashed ${rgba(ac, .5)};margin:8px 0"></div>`); }
    else if ((m = line.match(/^>\s?(.*)/))) { close(); out.push(`<div style="border-left:2px solid ${ac};padding:2px 0 2px 9px;margin:0 0 6px;color:rgba(233,234,247,.75)">${inl(m[1])}</div>`); }
    else if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)/))) {
      open('chk'); const on = m[1] !== ' ';
      out.push(`<li style="display:flex;gap:7px;align-items:baseline"><span style="color:${ac};flex:none">${on ? '■' : '□'}</span><span style="${on ? 'opacity:.55;text-decoration:line-through' : ''}">${inl(m[2])}</span></li>`);
    }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { open('ul'); out.push(`<li>${inl(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { open('ol'); out.push(`<li>${inl(m[1])}</li>`); }
    else if (!line.trim()) { close(); out.push('<div style="height:6px"></div>'); }
    else { close(); out.push(`<div style="margin:0 0 4px">${inl(line)}</div>`); }
  }
  if (code !== null) out.push(`<pre style="margin:0;white-space:pre-wrap;color:${ac}">${esc((code as string[]).join('\n'))}</pre>`);
  close();
  return out.join('');
}
