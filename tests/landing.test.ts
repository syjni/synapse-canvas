import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { stepDust, DUST, type Dust } from '../src/landing/dust';
import { SITE_LANGS, landingFile, outputs, siteDict } from '../scripts/site.mjs';
import { pickLang } from '../src/i18n';

const still = (x: number, y: number): Dust => ({ x, y, vx: 0, vy: 0, ox: 0, oy: 0, ovx: 0, ovy: 0 });

describe('소개 페이지 먼지 입자', () => {
  it('커서 반경 안의 입자는 커서 반대쪽으로 밀려나고, 반경 밖은 그대로', () => {
    const near = still(130, 100), far = still(400, 100);
    for (let i = 0; i < 30; i++) { stepDust(near, 100, 100, 1, 800, 600); stepDust(far, 100, 100, 1, 800, 600); }
    expect(near.ox).toBeGreaterThan(5);
    expect(Math.abs(near.oy)).toBeLessThan(0.001);
    expect([far.ox, far.oy]).toEqual([0, 0]);
  });
  it('커서가 지나가면 튕기지 않고(반대쪽으로 넘어가지 않고) 감속하며 원래 자리로', () => {
    const p = still(110, 100);
    for (let i = 0; i < 40; i++) stepDust(p, 100, 100, 1, 800, 600);
    const pushed = p.ox;
    let prev = pushed;
    for (let i = 0; i < 1200; i++) {
      stepDust(p, -1e4, -1e4, 1, 800, 600);
      expect(p.ox).toBeGreaterThanOrEqual(0);        // 원래 자리를 지나쳐 튕기지 않음
      if (i > 40) expect(p.ox).toBeLessThanOrEqual(prev + 1e-9);   // 밀린 관성이 사라진 뒤로는 계속 줄어듦
      prev = p.ox;
    }
    expect(pushed).toBeGreaterThan(DUST.R / 4);
    expect(p.ox).toBeLessThan(0.5);
  });
});

describe('언어별 소개 페이지·검색엔진 설정', () => {
  const files = SITE_LANGS.map(L => [L, fs.readFileSync(landingFile(L), 'utf8')] as const);

  it('미리 만든 페이지·사이트맵이 최신이다 (문구를 바꿨다면 node scripts/site.mjs)', () => {
    for (const [f, html] of outputs()) expect(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), f).toBe(html);
  });
  it.each(files)('$code: FAQ 구조화 데이터의 질문·답이 페이지에 보이는 글과 같다', (L, html) => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const faq = ld['@graph'].find((x: { '@type': string }) => x['@type'] === 'FAQPage');
    const app = ld['@graph'].find((x: { '@type': string }) => x['@type'] === 'SoftwareApplication');
    expect(app).toMatchObject({ name: 'PixieMap', applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Windows, iOS, Android', inLanguage: L.code, offers: { price: '0' } });
    const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const shown = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(m => [text(m[1]), text(m[2])]);
    expect(faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text])).toEqual(shown);
    expect(shown.length).toBeGreaterThanOrEqual(4);
  });
  it.each(files)('$code: lang·canonical·hreflang(x-default=영어)·og 태그가 그 언어로', (L, html) => {
    const self = `https://pixiemap.pages.dev/${L.dir}`;
    expect(html).toContain(`<html lang="${L.code}">`);
    expect(html).toContain(`<link rel="canonical" href="${self}" />`);
    for (const l of SITE_LANGS) expect(html).toContain(`<link rel="alternate" hreflang="${l.code}" href="https://pixiemap.pages.dev/${l.dir}" />`);
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://pixiemap.pages.dev/en/" />');
    expect(html).toContain(`<meta property="og:locale" content="${L.og}" />`);
    expect(html).toContain(`<meta property="og:url" content="${self}" />`);
    expect(html).toContain(`<title>${siteDict(L.code).title}</title>`);
    // 하단 언어 전환: 다섯 언어 모두, 지금 언어에 aria-current
    expect([...html.matchAll(/data-lang="([^"]+)"/g)].map(m => m[1])).toEqual(SITE_LANGS.map(l => l.code));
    expect(html).toContain(`data-lang="${L.code}" aria-current="page"`);
  });
  it('한국어 제목·설명에 핵심 표현이 자연스럽게 들어 있다', () => {
    const landing = files[0][1];
    const desc = landing.match(/<meta name="description" content="([^"]+)"/)![1];
    for (const w of ['감성', '예쁜', '무료', '마인드맵', '로파이']) expect(desc).toContain(w);
    expect(landing).toMatch(/<meta property="og:locale" content="ko_KR"/);
  });
  it('개인정보처리방침도 다섯 언어로, 서로 hreflang으로 이어진다', () => {
    for (const L of SITE_LANGS) {
      const html = fs.readFileSync(`public/${L.dir}privacy.html`, 'utf8');
      expect(html, L.code).toContain(`<html lang="${L.code}">`);
      expect(html).toContain(`<link rel="canonical" href="https://pixiemap.pages.dev/${L.dir}privacy">`);
      for (const [code, dir] of [...SITE_LANGS.map(x => [x.code, x.dir]), ['x-default', 'en/']]) expect(html, `${L.code} → ${code}`).toContain(`<link rel="alternate" hreflang="${code}" href="https://pixiemap.pages.dev/${dir}privacy">`);
      // 같은 구성 (7개 항목, 표 18줄)
      expect((html.match(/<h2>/g) || []).length, L.code).toBe(7);
      expect((html.match(/<tr>/g) || []).length, L.code).toBe(18);
    }
  });
  it('/app은 noindex이고 사이트맵에 없으며, 사이트맵에 언어별 페이지가 있고 robots.txt가 사이트맵을 알려 준다', () => {
    expect(fs.readFileSync('app.html', 'utf8')).toMatch(/<meta name="robots" content="noindex"/);
    const sm = fs.readFileSync('public/sitemap.xml', 'utf8');
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs).toHaveLength(15);
    for (const p of ['', 'privacy', 'licenses']) for (const L of SITE_LANGS) expect(locs).toContain(`https://pixiemap.pages.dev/${L.dir}${p}`);
    expect(locs.some(u => /\/app/.test(u))).toBe(false);
    expect(fs.readFileSync('public/robots.txt', 'utf8')).toMatch(/Sitemap: https:\/\/pixiemap\.pages\.dev\/sitemap\.xml/);
  });
});

// 루트(/)의 머리 스크립트를 가짜 브라우저 환경에서 돌려 어디로 보내는지 본다
describe('루트(/) 첫 방문 언어 이동', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(c => c.includes('pixiemap-site-lang'))!;
  function visit(o: { langs?: string[]; ua?: string; store?: Record<string, string>; search?: string; webdriver?: boolean }) {
    const store = new Map(Object.entries(o.store || {}));
    let went: string | null = null;
    const env = {
      document: { documentElement: { className: '' } },
      location: { search: o.search || '', hash: '', replace: (u: string) => { went = u; } },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
      navigator: { languages: o.langs || [], language: (o.langs || [])[0] || '', userAgent: o.ua || 'Mozilla/5.0 Chrome/140', webdriver: !!o.webdriver },
      matchMedia: () => ({ matches: false }),
      indexedDB: {},
      setTimeout,
    };
    new Function(...Object.keys(env), code)(...Object.values(env));
    return { went, saved: store.get('pixiemap-site-lang') ?? null };
  }
  it.each([
    [['ja-JP'], 'ja/', 'ja'], [['zh-CN'], 'zh-hans/', 'zh-Hans'], [['es-AR'], 'es/', 'es'], [['en-US'], 'en/', 'en'],
    [['zh-TW'], 'en/', 'en'], [['fr-FR'], 'en/', 'en'], [['ko-KR'], null, 'ko'],
  ] as [string[], string | null, string][])('기기 언어 %j → %s (선택을 기억)', (langs, went, saved) => {
    expect(visit({ langs })).toEqual({ went, saved });
  });
  it('src/i18n의 pickLang과 같은 규칙', () => {
    for (const langs of [['zh-Hant-CN'], ['zh-HK', 'es-MX'], ['zh'], ['zh-Hans-HK'], ['de', 'ja'], ['ko_KR'], []]) {
      expect(visit({ langs }).saved, JSON.stringify(langs)).toBe(pickLang(langs));
    }
  });
  it('기억한 선택이 있으면 그대로 (한국어를 고른 사람은 / 에 머문다)', () => {
    expect(visit({ langs: ['ja'], store: { 'pixiemap-site-lang': 'ko' } }).went).toBe(null);
    expect(visit({ langs: ['ko'], store: { 'pixiemap-site-lang': 'es' } }).went).toBe('es/');
  });
  it('검색엔진 크롤러·자동화 브라우저는 옮기지 않고 기억도 하지 않는다', () => {
    for (const ua of ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)', 'Mozilla/5.0 (Linux) HeadlessChrome/120'])
      expect(visit({ langs: ['en-US'], ua }), ua).toEqual({ went: null, saved: null });
    expect(visit({ langs: ['en-US'], webdriver: true })).toEqual({ went: null, saved: null });
  });
  it('이미 쓰던 사람은 언어 페이지가 아니라 캔버스로, ?intro면 캔버스로 보내지 않고 쿼리를 유지한다', () => {
    expect(visit({ langs: ['ja'], store: { 'pixiemap-used': '1' } }).went).toBe('app');
    expect(visit({ langs: ['ja'], store: { 'pixiemap-used': '1' }, search: '?intro' }).went).toBe('ja/?intro');
  });
  it('언어 페이지(/en/ 등)에는 이동 스크립트가 없다 (검색 결과로 바로 들어온 사람은 그대로)', () => {
    for (const L of SITE_LANGS.filter(l => l.dir)) expect(fs.readFileSync(landingFile(L), 'utf8')).not.toContain('location.replace');
  });
});
