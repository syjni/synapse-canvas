// dc.html의 route()(A*), ports/curve/dendrite/smooth/roundPath 그대로 이식
export type Rect = { x: number; y: number; w: number; h: number };
export type Pt = { x: number; y: number };

class Heap {
  k: number[] = []; v: number[] = [];
  push(k: number, v: number) { const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v); while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; } K[i] = k; V[i] = v; }
  pop() { const K = this.k, V = this.v, top = V[0], lk = K.pop()!, lv = V.pop()!, n = K.length; if (n) { let i = 0; while (true) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= lk) break; K[i] = K[c]; V[i] = V[c]; i = c; } K[i] = lk; V[i] = lv; } return top; }
  get size() { return this.k.length; }
}

export function route(A: Rect, B: Rect, rects: Rect[]): Pt[] | null {
  const G = 12, P = 12, DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const cxA = A.x + A.w / 2, cyA = A.y + A.h / 2, cxB = B.x + B.w / 2, cyB = B.y + B.h / 2;
  const gapX = Math.abs(cxB - cxA) - (A.w + B.w) / 2, gapY = Math.abs(cyB - cyA) - (A.h + B.h) / 2;
  let pA: Pt, pB: Pt, dA: number, dB: number;
  if (gapX >= gapY) { const r = cxB > cxA; pA = { x: r ? A.x + A.w : A.x, y: cyA }; dA = r ? 0 : 2; pB = { x: r ? B.x : B.x + B.w, y: cyB }; dB = r ? 2 : 0; }
  else { const d = cyB > cyA; pA = { x: cxA, y: d ? A.y + A.h : A.y }; dA = d ? 1 : 3; pB = { x: cxB, y: d ? B.y : B.y + B.h }; dB = d ? 3 : 1; }
  const M = 220;
  const minX = Math.min(A.x, B.x) - M, minY = Math.min(A.y, B.y) - M;
  const maxX = Math.max(A.x + A.w, B.x + B.w) + M, maxY = Math.max(A.y + A.h, B.y + B.h) + M;
  const cols = Math.ceil((maxX - minX) / G) + 1, rows = Math.ceil((maxY - minY) / G) + 1;
  if (cols * rows > 60000) return null;
  const blk = new Uint8Array(cols * rows);
  for (const r of rects) {
    const x0 = r.x - P, y0 = r.y - P, x1 = r.x + r.w + P, y1 = r.y + r.h + P;
    if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue;
    const i0 = Math.max(0, Math.ceil((x0 - minX) / G)), i1 = Math.min(cols - 1, Math.floor((x1 - minX) / G));
    const j0 = Math.max(0, Math.ceil((y0 - minY) / G)), j1 = Math.min(rows - 1, Math.floor((y1 - minY) / G));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blk[j * cols + i] = 1;
  }
  const cell = (p: Pt, d: number) => {
    let i = Math.round((p.x + DX[d] * (P + G / 2) - minX) / G), j = Math.round((p.y + DY[d] * (P + G / 2) - minY) / G);
    while (i >= 0 && j >= 0 && i < cols && j < rows && blk[j * cols + i]) { i += DX[d]; j += DY[d]; }
    return [Math.max(0, Math.min(cols - 1, i)), Math.max(0, Math.min(rows - 1, j))];
  };
  const [si, sj] = cell(pA, dA), [ei, ej] = cell(pB, dB);
  const S = sj * cols + si, E = ej * cols + ei;
  blk[S] = 0; blk[E] = 0;
  const N = cols * rows * 4, dist = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1);
  const h = new Heap(); const s0 = S * 4 + dA; dist[s0] = 0; h.push(0, s0);
  const endDir = (dB + 2) % 4; let best = -1, bestC = 1e9, pops = 0;
  const hx = (c: number) => Math.abs((c % cols) - ei) + Math.abs(((c / cols) | 0) - ej);
  while (h.size && pops++ < 120000) {
    const st = h.pop(), c = st >> 2, d = st & 3, cd = dist[st];
    if (c === E) { const tot = cd + (d === endDir ? 0 : 6); if (tot < bestC) { bestC = tot; best = st; } if (d === endDir) break; continue; }
    if (cd > bestC) break;
    const ci = c % cols, cj = (c / cols) | 0;
    for (let nd = 0; nd < 4; nd++) {
      if (nd === ((d + 2) & 3)) continue;
      const ni = ci + DX[nd], nj = cj + DY[nd];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nc = nj * cols + ni; if (blk[nc]) continue;
      const ns = nc * 4 + nd, cost = cd + 1 + (nd !== d ? 5 : 0);
      if (cost < dist[ns]) { dist[ns] = cost; prev[ns] = st; h.push(cost + hx(nc), ns); }
    }
  }
  if (best < 0) return null;
  const cells: number[] = []; for (let st = best; st >= 0; st = prev[st]) cells.push(st >> 2);
  cells.reverse();
  const pts = cells.map(c => ({ x: minX + (c % cols) * G, y: minY + ((c / cols) | 0) * G }));
  const c0 = pts[0], cn = pts[pts.length - 1];
  const lead = dA % 2 === 0 ? { x: c0.x, y: pA.y } : { x: pA.x, y: c0.y };
  const tail = dB % 2 === 0 ? { x: cn.x, y: pB.y } : { x: pB.x, y: cn.y };
  const all = [pA, lead, ...pts, tail, pB];
  const out: Pt[] = [];
  for (const p of all) {
    const L = out.length;
    if (L && out[L - 1].x === p.x && out[L - 1].y === p.y) continue;
    if (L >= 2) { const a = out[L - 2], b = out[L - 1]; if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) { out[L - 1] = p; continue; } }
    out.push(p);
  }
  return out;
}

export const ports = (A: Rect, B: Rect): (Pt & { h: number })[] => {
  const cxA = A.x + A.w / 2, cyA = A.y + A.h / 2, cxB = B.x + B.w / 2, cyB = B.y + B.h / 2;
  const gapX = Math.abs(cxB - cxA) - (A.w + B.w) / 2, gapY = Math.abs(cyB - cyA) - (A.h + B.h) / 2;
  if (gapX >= gapY) { const r = cxB > cxA; return [{ x: r ? A.x + A.w : A.x, y: cyA, h: 1 }, { x: r ? B.x : B.x + B.w, y: cyB, h: 1 }]; }
  const d = cyB > cyA; return [{ x: cxA, y: d ? A.y + A.h : A.y, h: 0 }, { x: cxB, y: d ? B.y : B.y + B.h, h: 0 }];
};
export const curve = (A: Rect, B: Rect) => {
  const [a, b] = ports(A, B);
  if (a.h) { const k = (b.x - a.x) * 0.5; return `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${b.x - k} ${b.y}, ${b.x} ${b.y}`; }
  const k = (b.y - a.y) * 0.5; return `M ${a.x} ${a.y} C ${a.x} ${a.y + k}, ${b.x} ${b.y - k}, ${b.x} ${b.y}`;
};
export const dendrite = (d: string, i: number) => {
  const n = (d.match(/-?[\d.]+/g) || []).map(Number); if (n.length < 8) return d;
  const o = (i % 2 ? 1 : -1) * 22;
  return `M ${n[0]} ${n[1]} C ${n[2]} ${n[3] + o}, ${n[4]} ${n[5] - o}, ${n[6]} ${n[7]}`;
};
export const smooth = (pts: [number, number][]) => {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`; }
  const l = pts[pts.length - 1]; return d + ` L ${l[0]} ${l[1]}`;
};
export const roundPath = (pts: Pt[], r: number) => {
  if (!r) return 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ');
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y), vx = Math.sign(c.x - b.x), vy = Math.sign(c.y - b.y);
    d += ` L ${b.x - ux * r1} ${b.y - uy * r1} Q ${b.x} ${b.y} ${b.x + vx * r1} ${b.y + vy * r1}`;
  }
  const l = pts[pts.length - 1]; return d + ` L ${l.x} ${l.y}`;
};
