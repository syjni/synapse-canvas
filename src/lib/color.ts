// dc.html 하단 스크립트에서 그대로 이식
export const oklchHex = (L: number, C: number, H: number): string => {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + lin.map(v => { v = Math.min(1, Math.max(0, v)); v = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(v * 255).toString(16).padStart(2, '0'); }).join('').toUpperCase();
};

// 색 이름은 언어 파일의 color.<key> (화면에서 t()로 꺼낸다 — 이 파일은 소개 페이지도 쓰므로 사전을 불러오지 않는다)
export type Swatch = { key: string; hex: string };
export const PALETTE: Swatch[] = ([['red', 22], ['orange', 55], ['yellow', 95], ['green', 150], ['cyan', 200], ['blue', 250], ['indigo', 280], ['violet', 315]] as const)
  .map(([key, h]) => ({ key, hex: oklchHex(0.76, 0.13, h) }));
export const PENS: Swatch[] = [{ key: 'white', hex: '#ECECF6' }, ...PALETTE];

export const rgba = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
