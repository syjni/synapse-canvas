import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import * as fontkitNs from 'fontkit';
import { LANGS, pickLang, t, setLang, fmtAgo, dual, type Lang } from '../src/i18n';
import { HELP_IDS } from '../src/ui/help';
import { seed, SEED_LANGS } from '../src/model';
import { isPristineSeed } from '../src/merge';
import { zhChars, FONT_OUT } from '../scripts/subset-zh-font.mjs';

// setLang이 <html lang>을 바꾸는지 보려고 최소한의 document만 둔다 (테스트는 node 환경)
(globalThis as unknown as { document: unknown }).document ??= { documentElement: { lang: '' } };
const fontkit = ((fontkitNs as unknown as { default?: typeof fontkitNs }).default || fontkitNs) as unknown as { openSync(p: string): { hasGlyphForCodePoint(c: number): boolean } };
const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
type Node = string | Node[] | { [k: string]: Node };
const isPlural = (v: Node): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, Node>).other === 'string';
// 끝값 경로 → 값 (복수형 객체는 하나의 끝값, 배열은 번호로)
function flat(o: Node, pre = '', out = new Map<string, Node>()) {
  if (typeof o === 'string' || isPlural(o)) { out.set(pre, o); return out; }
  for (const [k, v] of Object.entries(o)) flat(v as Node, pre ? `${pre}.${k}` : k, out);
  return out;
}
const vars = (v: Node) => new Set((typeof v === 'string' ? [v] : Object.values(v as Record<string, string>)).flatMap(s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1])));

describe.each([
  ['앱', (l: string) => `src/i18n/${l}.json`],
  ['소개 페이지', (l: string) => `src/i18n/site/${l}.json`],
])('언어 파일 (%s)', (_name, file) => {
  const ko = flat(read(file('ko')));
  it.each(LANGS.filter(l => l !== 'ko'))('%s: 한국어와 같은 키가 빠짐없이 있고 남는 키도 없다', l => {
    const other = flat(read(file(l)));
    const missing = [...ko.keys()].filter(k => !other.has(k));
    const extra = [...other.keys()].filter(k => !ko.has(k));
    expect(missing, `${l}에 빠진 키`).toEqual([]);
    expect(extra, `${l}에만 있는 키`).toEqual([]);
  });
  it.each(LANGS)('%s: 빈 문구가 없고, {값} 자리표시가 한국어와 같다', l => {
    for (const [k, v] of flat(read(file(l)))) {
      const strs = typeof v === 'string' ? [v] : Object.values(v as Record<string, string>);
      for (const s of strs) expect(s.trim(), `${l} ${k}`).not.toBe('');
      expect([...vars(v)].sort(), `${l} ${k}`).toEqual([...vars(ko.get(k)!)].sort());
    }
  });
  it.each(LANGS)('%s: 복수형 객체에 그 언어의 복수 범주가 모두 있다', l => {
    const cats = new Intl.PluralRules(l).resolvedOptions().pluralCategories;
    for (const [k, v] of flat(read(file(l)))) if (isPlural(v)) expect(Object.keys(v).sort(), `${l} ${k}`).toEqual([...cats].sort());
  });
});

describe('예시 상자 글 (seed.json)', () => {
  const all = read('src/i18n/seed.json');
  it('모든 언어에 같은 상자가 있다', () => {
    expect(Object.keys(all).sort()).toEqual([...LANGS].sort());
    for (const l of LANGS) expect(Object.keys(all[l]).sort(), l).toEqual(Object.keys(all.ko).sort());
  });
  it('카테고리 이름은 모든 언어에서 영어 그대로, 어느 언어의 예시든 "손대지 않은 예시"로 본다', () => {
    for (const l of SEED_LANGS) {
      const d = seed(l);
      expect(d.cats.map(c => c.name)).toEqual(['Mind', 'Ideas', 'Schedule', 'Custom 1', 'Custom 2', 'Custom 3']);
      expect(isPristineSeed(d), l).toBe(true);
    }
  });
});

describe('사용 안내(MANUAL) 항목', () => {
  it('help 묶음의 항목마다 [이름, 설명]이 있다', () => {
    const ko = read('src/i18n/ko.json').help;
    for (const mode of ['desktop', 'touch'] as const) {
      const ids = HELP_IDS[mode].flatMap(([, ids]) => ids);
      expect(ids.sort()).toEqual(Object.keys(ko[mode]).sort());
      for (const id of ids) expect(ko[mode][id]).toHaveLength(2);
    }
  });
});

describe('언어 고르기 (navigator.languages)', () => {
  it.each([
    [['ko-KR', 'en-US'], 'ko'], [['ja'], 'ja'], [['en-GB'], 'en'], [['es-MX'], 'es'], [['es-419'], 'es'], [['es-ES'], 'es'],
    [['zh-CN'], 'zh-Hans'], [['zh-SG'], 'zh-Hans'], [['zh-Hans-HK'], 'zh-Hans'], [['zh'], 'zh-Hans'],
    [['zh-TW'], 'en'], [['zh-HK', 'ja-JP'], 'ja'], [['zh-Hant-CN'], 'en'], [['zh-MO'], 'en'],
    [['fr-FR', 'de'], 'en'], [['fr-FR', 'es-AR'], 'es'], [[], 'en'], [['ko_KR'], 'ko'],
  ] as [string[], Lang][])('%j → %s', (list, want) => expect(pickLang(list)).toBe(want));
});

describe('문구 꺼내기 t()', () => {
  afterAll(() => setLang('ko'));
  it('한국어(기본)', () => {
    expect(t('toast.addedBoxes', { n: 3 })).toBe('3개 상자를 추가했어요');
    expect(t('nope.missing')).toBe('nope.missing');
    expect(dual('SETTINGS', t('head.settings'))).toBe('SETTINGS / 설정');
  });
  it('영어: 1 box / 2 boxes, 픽셀 라벨과 같은 설명은 한 번만', async () => {
    await setLang('en');
    expect(t('toast.addedBoxes', { n: 1 })).toBe('Added 1 box');
    expect(t('toast.addedBoxes', { n: 2 })).toBe('Added 2 boxes');
    expect(t('sync.backupBoxes', { n: 0 })).toBe('0 boxes');
    expect(dual('SETTINGS', t('head.settings'))).toBe('SETTINGS');
    expect(document.documentElement.lang).toBe('en');
  });
  it('스페인어: 1 caja / 2 cajas / 1000000 (many)', async () => {
    await setLang('es');
    expect(t('sync.backupBoxes', { n: 1 })).toBe('1 caja');
    expect(t('sync.backupBoxes', { n: 2 })).toBe('2 cajas');
    expect(t('sync.backupBoxes', { n: 1000000 })).toBe('1000000 cajas');
    expect(fmtAgo(Date.now() - 30_000)).toBe('ahora mismo');
    expect(fmtAgo(Date.now() - 3 * 3600_000)).toMatch(/3 horas/);
  });
  it('일본어·중국어: 복수형 없이 하나', async () => {
    await setLang('ja');
    expect(t('toast.addedBoxes', { n: 1 })).toBe('ボックスを1個追加しました');
    await setLang('zh-Hans');
    expect(t('toast.addedBoxes', { n: 5 })).toBe('已添加 5 个方框');
  });
});

describe('폰트', () => {
  const strings = (x: unknown): string[] => (typeof x === 'string' ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === 'object' ? Object.values(x).flatMap(strings) : []);
  const textOf = (l: string) => [...strings(read(`src/i18n/${l}.json`)), ...strings(read(`src/i18n/site/${l}.json`)), ...strings(read('src/i18n/seed.json')[l])].join('');
  // 원래부터 시스템 글꼴로 넘어가던 기호 (모든 언어 공통)
  const KNOWN = new Set([...'⛶✕⌘']);
  let fonts: Record<string, { hasGlyphForCodePoint(c: number): boolean }>;
  beforeAll(() => { fonts = Object.fromEntries(['Galmuri11', 'GalmuriMono11', 'GalmuriMono9'].map(f => [f, fontkit.openSync(`node_modules/galmuri/dist/${f}.woff2`)])); });

  it.each(['ko', 'en', 'ja', 'es'])('%s: 갈무리 3종이 문구의 글자를 모두 갖고 있다', l => {
    const chars = [...new Set(textOf(l))].filter(c => c.trim() && !KNOWN.has(c));
    for (const [name, f] of Object.entries(fonts)) {
      const miss = chars.filter(c => !f.hasGlyphForCodePoint(c.codePointAt(0)!));
      expect(miss.join(''), `${l} ${name}`).toBe('');
    }
  });
  it('중국어 간체: 갈무리에 없는 간체자가 있어 퓨전 픽셀 서브셋이 필요하고, 서브셋에 빠진 글자가 없다', () => {
    const chars = [...zhChars()];
    expect(chars.some(c => !fonts.Galmuri11.hasGlyphForCodePoint(c.codePointAt(0)!))).toBe(true);
    const sub = fontkit.openSync(FONT_OUT);
    const miss = chars.filter(c => !sub.hasGlyphForCodePoint(c.codePointAt(0)!));
    expect(miss.join(''), '문구를 바꿨다면 node scripts/subset-zh-font.mjs <원본 ttf>로 다시 만드세요').toBe('');
    expect(fs.statSync(FONT_OUT).size).toBeLessThan(60 * 1024);
  });
  it('퓨전 픽셀 라이선스(OFL) 전문을 오픈소스 라이선스 화면에 싣는다', () => {
    const lic = fs.readFileSync('src/fonts/fusion-pixel-LICENSE.txt', 'utf8');
    expect(lic).toMatch(/Fusion Pixel Font/);
    expect(lic).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
    expect(fs.readFileSync('vite.config.ts', 'utf8')).toMatch(/fusion-pixel-LICENSE\.txt/);
  });
});
