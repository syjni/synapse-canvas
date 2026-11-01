// 중국어 간체 화면용 퓨전 픽셀 폰트 서브셋 만들기 (문구를 바꾼 뒤 한 번 실행해서 결과 woff2를 커밋한다)
//
//   node scripts/subset-zh-font.mjs <fusion-pixel-12px-proportional-zh_hans.ttf>
//
// 원본: https://github.com/TakWolf/fusion-pixel-font/releases (12px proportional ttf, SIL OFL 1.1)
// 앱·소개 페이지의 중국어 간체 문구와 언어 이름에 쓰인 한자·문장부호만 남긴다.
// tests/i18n.test.ts가 서브셋에 빠진 글자가 없는지 검사한다 (문구를 바꾸고 다시 만들지 않으면 실패).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FONT_OUT = 'src/fonts/fusion-pixel-12px-zh_hans.subset.woff2';
// src/i18n/font.ts의 CJK_RANGE와 같은 범위
const CJK = /[⺀-⿟　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u;

const strings = x => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);
const json = f => JSON.parse(fs.readFileSync(f, 'utf8'));

// 서브셋에 들어가야 하는 글자 (정렬된 문자열)
export function zhChars() {
  const src = [
    ...strings(json('src/i18n/zh-Hans.json')),
    ...strings(json('src/i18n/seed.json')['zh-Hans']),
    ...strings(json('src/i18n/site/zh-Hans.json')),
    // 언어 선택 목록(모든 언어 화면에 나온다)
    '한국어 English 日本語 简体中文 Español',
  ].join('');
  return [...new Set([...src].filter(ch => CJK.test(ch)))].sort().join('');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const input = process.argv[2];
  if (!input) { console.error('사용법: node scripts/subset-zh-font.mjs <fusion-pixel-12px-proportional-zh_hans.ttf>'); process.exit(1); }
  const { default: subsetFont } = await import('subset-font');
  const chars = zhChars();
  const out = await subsetFont(fs.readFileSync(input), chars, { targetFormat: 'woff2' });
  fs.writeFileSync(FONT_OUT, out);
  console.log(`${FONT_OUT}: ${chars.length}자, ${(out.length / 1024).toFixed(1)} KB`);
}
