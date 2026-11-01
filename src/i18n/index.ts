// 다국어: 화면 문구는 언어별 JSON(ko·en·ja·zh-Hans·es)에 두고 t('키', { 값 })로 꺼낸다.
// - 한국어는 기본·대체 언어라 번들에 함께 넣고, 나머지 언어는 고를 때 불러온다.
// - 복수형은 { "one": "...", "other": "..." } 객체로 두고 Intl.PluralRules로 고른다 (vars.n 기준).
// - 언어 선택은 기기별(localStorage). 동기화하지 않는다.
import ko from './ko.json';

export const LANGS = ['ko', 'en', 'ja', 'zh-Hans', 'es'] as const;
export type Lang = typeof LANGS[number];
// 언어 선택 목록에는 각 언어를 그 언어 이름으로
export const LANG_NAMES: Record<Lang, string> = { ko: '한국어', en: 'English', ja: '日本語', 'zh-Hans': '简体中文', es: 'Español' };

// 값은 문자열, 하위 묶음, 복수형 객체, 또는 배열(help 항목 [이름, 설명])
type Dict = { [k: string]: string | Dict };
const KO = ko as unknown as Dict;
const asDict = (m: { default: unknown }) => m.default as Dict;
const loaders: Record<Lang, () => Promise<Dict>> = {
  ko: async () => KO,
  en: () => import('./en.json').then(asDict),
  ja: () => import('./ja.json').then(asDict),
  'zh-Hans': () => import('./zh-Hans.json').then(asDict),
  es: () => import('./es.json').then(asDict),
};

export const LANG_KEY = 'pixiemap-lang';        // 앱에서 고른 언어
export const SITE_LANG_KEY = 'pixiemap-site-lang';   // 소개 페이지에서 고른 언어 (앱에서 아직 고른 적 없을 때 따른다)

// 기기 언어 목록(navigator.languages)에서 지원 언어 중 가장 앞선 것. 없으면 영어.
// 중국어는 간체(zh, zh-CN, zh-SG, zh-Hans-*)만 지원하고 번체(zh-TW, zh-HK, zh-MO, zh-Hant-*)는 건너뛴다.
export function pickLang(list: readonly string[]): Lang {
  for (const raw of list) {
    const tag = String(raw || '').toLowerCase().replace(/_/g, '-');
    const [base, ...rest] = tag.split('-');
    if (base === 'zh') {
      if (rest.includes('hans')) return 'zh-Hans';
      if (rest.includes('hant') || rest.some(r => r === 'tw' || r === 'hk' || r === 'mo')) continue;
      return 'zh-Hans';
    }
    const hit = LANGS.find(l => l === base);
    if (hit) return hit;
  }
  return 'en';
}
export const isLang = (x: unknown): x is Lang => LANGS.includes(x as Lang);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
// 저장된 선택 → 소개 페이지에서 고른 언어 → 기기 언어
export function detectLang(): Lang {
  const saved = read(LANG_KEY);
  if (isLang(saved)) return saved;
  const site = read(SITE_LANG_KEY);
  if (isLang(site)) return site;
  const nav = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return pickLang(nav);
}

let lang: Lang = 'ko';
let dict: Dict = KO;
const listeners = new Set<() => void>();
export const getLang = () => lang;
export function subscribeLang(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

function apply(l: Lang, d: Dict) {
  lang = l; dict = d;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  plurals.clear();
  listeners.forEach(f => f());
}
// 앱 시작 때 한 번: 기기에 맞는 언어 사전을 불러온다
export async function initLang(): Promise<Lang> {
  const l = detectLang();
  try { apply(l, await loaders[l]()); } catch { apply('ko', KO); }
  return lang;
}
// 설정에서 언어 바꾸기 (이 기기에만 저장)
export async function setLang(l: Lang): Promise<void> {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* 저장 불가 환경: 이번 실행에만 적용 */ }
  apply(l, await loaders[l]());
}

const plurals = new Map<string, Intl.PluralRules>();
const pluralOf = (n: number) => {
  let r = plurals.get(lang);
  if (!r) { r = new Intl.PluralRules(lang); plurals.set(lang, r); }
  return r.select(n);
};
const lookup = (d: Dict, key: string): string | Dict | undefined => {
  let cur: string | Dict | undefined = d;
  for (const p of key.split('.')) { if (!cur || typeof cur === 'string') return undefined; cur = cur[p]; }
  return cur;
};

export type Vars = Record<string, string | number>;
export function t(key: string, vars?: Vars): string {
  let v = lookup(dict, key);
  if (v === undefined) v = lookup(KO, key);
  if (v && typeof v === 'object') {
    // 복수형: 언어 규칙의 범주(one, few, many…)가 없으면 other
    const n = Number(vars?.n ?? 0);
    const forms = v as Record<string, string>;
    v = forms[pluralOf(n)] ?? forms.other;
  }
  if (typeof v !== 'string') return key;
  return vars ? v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : v;
}

// 영문 픽셀 라벨 + 번역 설명 ("SETTINGS / 설정"). 번역이 라벨과 같으면(영어) 라벨만
export const dual = (label: string, desc: string) => (desc.toUpperCase() === label.toUpperCase() ? label : `${label} / ${desc}`);

// ── 날짜·시간 (Intl) ─────────────────────────────────
const fmtCache = new Map<string, Intl.DateTimeFormat>();
const dtf = (o: Intl.DateTimeFormatOptions) => {
  const k = lang + JSON.stringify(o);
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(lang, o); fmtCache.set(k, f); }
  return f;
};
// 저장 상태(SAVED 14:05)용 시:분. 한국어 기본값은 "오후 2:05"라 예전처럼 24시간제로 둔다
export const fmtTime = (d: Date | number) => dtf(lang === 'ko' ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : { hour: 'numeric', minute: '2-digit' }).format(d);
export const fmtDateTime = (d: Date | number) => dtf({ dateStyle: 'medium', timeStyle: 'short', ...(lang === 'ko' ? { hourCycle: 'h23' as const } : {}) }).format(d);
// "3분 전" 같은 상대 시각. 90초 안쪽은 "방금"
export function fmtAgo(iso: string | number, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 90) return t('time.justNow');
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

// 개인정보처리방침 주소 (언어별 페이지)
export const SITE_PATH: Record<Lang, string> = { ko: '', en: 'en/', ja: 'ja/', 'zh-Hans': 'zh-hans/', es: 'es/' };
