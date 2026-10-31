// README 로고(강조색 정사각 도트 + 글로우)를 바탕으로 PWA 아이콘을 생성한다.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const ACCENT = '#6DB6FF';
const EDGE = '#A1A7FF';

// pad: 마스커블 안전 영역(가운데 80%)에 맞추기 위한 도트 축소 비율
const svg = (pad = 1) => {
  const s = 512, d = 120 * pad, c = s / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <defs>
    <radialGradient id="h1" cx="0.18" cy="0.12" r="0.7"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".28"/><stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient>
    <radialGradient id="h2" cx="0.9" cy="0.95" r="0.6"><stop offset="0" stop-color="${EDGE}" stop-opacity=".22"/><stop offset="1" stop-color="${EDGE}" stop-opacity="0"/></radialGradient>
    <filter id="g" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${34 * pad}"/></filter>
    <filter id="g2" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${12 * pad}"/></filter>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1.3" fill="#000" fill-opacity=".22"/></pattern>
  </defs>
  <rect width="${s}" height="${s}" fill="#050509"/>
  <rect width="${s}" height="${s}" fill="url(#h1)"/>
  <rect width="${s}" height="${s}" fill="url(#h2)"/>
  <rect x="${c - d}" y="${c - d}" width="${d * 2}" height="${d * 2}" fill="${ACCENT}" opacity=".55" filter="url(#g)"/>
  <rect x="${c - d / 2}" y="${c - d / 2}" width="${d}" height="${d}" fill="${ACCENT}" opacity=".9" filter="url(#g2)"/>
  <rect x="${c - d / 2}" y="${c - d / 2}" width="${d}" height="${d}" fill="${ACCENT}"/>
  <rect width="${s}" height="${s}" fill="url(#scan)"/>
</svg>`;
};

const out = async (name, size, pad) => {
  await sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(`public/${name}`);
  console.log('wrote', name);
};

await out('icon-192.png', 192, 1);
await out('icon-512.png', 512, 1);
await out('icon-maskable-192.png', 192, 0.8);
await out('icon-maskable-512.png', 512, 0.8);
await out('apple-touch-icon.png', 180, 0.9);
writeFileSync('public/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#050509"/><rect x="10" y="10" width="12" height="12" fill="${ACCENT}" opacity=".5" filter="blur(2px)"/><rect x="12" y="12" width="8" height="8" fill="${ACCENT}"/></svg>`);
