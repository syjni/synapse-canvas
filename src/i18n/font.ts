// 중국어 간체 화면에서만 한자·중국어 문장부호를 퓨전 픽셀 폰트(서브셋)로 그린다.
// 갈무리는 간체자 상당수(GB2312 1급의 약 37%)가 없어서, 같은 이름의 글꼴에 unicode-range로 덧붙인다.
// 같은 글꼴 이름에 범위가 겹치는 @font-face가 여럿이면 나중에 선언한 쪽을 먼저 쓰므로 한자는 모두 퓨전 픽셀로 맞춰지고,
// 서브셋에 없는 글자(사용자가 쓴 글 등)는 갈무리 → 시스템 글꼴 순으로 넘어간다.
import fusionUrl from '../fonts/fusion-pixel-12px-zh_hans.subset.woff2?url';
import { getLang, subscribeLang } from '.';

// 한중일 문장부호 · CJK 부수 · 통합 한자(확장 A 포함) · 호환 한자 · 전각 문자
export const CJK_RANGE = 'U+2E80-2FDF, U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF';
const FAMILIES = ['Galmuri11', 'GalmuriMono11', 'GalmuriMono9'];
const css = FAMILIES.map(f => `@font-face { font-family: ${f}; font-weight: 400; font-display: swap; src: url('${fusionUrl}') format('woff2'); unicode-range: ${CJK_RANGE}; }`).join('\n');

let started = false;
export function syncCjkFont() {
  const apply = () => {
    let el = document.getElementById('cjk-font') as HTMLStyleElement | null;
    const on = getLang() === 'zh-Hans';
    if (on && !el) { el = document.createElement('style'); el.id = 'cjk-font'; el.textContent = css; document.head.appendChild(el); }
    if (!on && el) el.remove();
  };
  apply();
  if (!started) { started = true; subscribeLang(apply); }
}
