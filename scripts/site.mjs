// 소개 페이지를 언어별 정적 HTML로 미리 만든다: / (한국어), /en/, /ja/, /zh-hans/, /es/  + sitemap.xml
//
//   node scripts/site.mjs      (문구는 src/i18n/site/<언어>.json — 바꾼 뒤 실행해서 결과 HTML을 커밋한다)
//
// 페이지끼리는 hreflang으로 잇고 x-default는 영어. tests/site.test.ts가 결과 파일이 최신인지 검사한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://pixiemap.pages.dev';
export const LASTMOD = '2026-11-01';
// dir: 사이트 안 경로(루트 기준), og: og:locale
export const SITE_LANGS = [
  { code: 'ko', dir: '', og: 'ko_KR', name: '한국어', currency: 'KRW' },
  { code: 'en', dir: 'en/', og: 'en_US', name: 'English', currency: 'USD' },
  { code: 'ja', dir: 'ja/', og: 'ja_JP', name: '日本語', currency: 'JPY' },
  { code: 'zh-Hans', dir: 'zh-hans/', og: 'zh_CN', name: '简体中文', currency: 'CNY' },
  { code: 'es', dir: 'es/', og: 'es_ES', name: 'Español', currency: 'USD' },
];
export const X_DEFAULT = 'en';
export const siteDict = code => JSON.parse(fs.readFileSync(`src/i18n/site/${code}.json`, 'utf8'));
export const landingFile = L => L.dir + 'index.html';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = h => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const url = (L, page = '') => ORIGIN + '/' + L.dir + page;

// 다른 언어 페이지 링크 (hreflang). page: '' = 소개, 'privacy', 'licenses'
export function alternates(page = '', indent = '    ') {
  const x = SITE_LANGS.find(l => l.code === X_DEFAULT);
  return [...SITE_LANGS.map(l => `<link rel="alternate" hreflang="${l.code}" href="${url(l, page)}" />`), `<link rel="alternate" hreflang="x-default" href="${url(x, page)}" />`]
    .map(s => indent + s).join('\n');
}
// 하단 언어 전환 링크. up: 루트까지의 상대 경로('' 또는 '../')
export function langNav(L, up, label, page = '') {
  const links = SITE_LANGS.map(l => {
    const href = (up + l.dir + page) || './';
    return `<a href="${href}" hreflang="${l.code}" lang="${l.code}" data-lang="${l.code}"${l.code === L.code ? ' aria-current="page"' : ''}>${l.name}</a>`;
  });
  return `<nav class="langs" aria-label="${esc(label)}">\n        ${links.join('\n        ')}\n      </nav>`;
}

// 루트(/)에만 넣는 스크립트: 이미 쓰던 사람·홈 화면 앱·기기 연결 QR은 바로 캔버스로,
// 처음 온 사람은 기기 언어에 맞는 소개 페이지로 한 번 옮기고 그 선택을 기억한다(하단 링크로 바꾸면 그 언어).
// 검색엔진 크롤러는 옮기지 않는다. ?intro면 캔버스로 보내지 않는다.
// 언어 고르기는 src/i18n/index.ts의 pickLang과 같은 규칙 (tests/site.test.ts에서 비교)
const ROOT_SCRIPT = `    <script>
      (function () {
        var d = document.documentElement; d.className += ' js';
        var leave = function (u) { d.className += ' leaving'; location.replace(u); };
        var DIRS = { en: 'en/', ja: 'ja/', 'zh-Hans': 'zh-hans/', es: 'es/' };
        var pick = function (list) {
          for (var i = 0; i < list.length; i++) {
            var p = String(list[i] || '').toLowerCase().replace(/_/g, '-').split('-'), b = p[0];
            if (b === 'zh') {
              if (p.indexOf('hans') > 0) return 'zh-Hans';
              if (p.indexOf('hant') > 0 || p.indexOf('tw') > 0 || p.indexOf('hk') > 0 || p.indexOf('mo') > 0) continue;
              return 'zh-Hans';
            }
            if (b === 'ko' || b === 'en' || b === 'ja' || b === 'es') return b;
          }
          return 'en';
        };
        var toLang = function () { try {
          if (navigator.webdriver || /bot|crawl|spider|slurp|yeti|daum|bingpreview|facebookexternalhit|embedly|headlesschrome|lighthouse|prerender/i.test(navigator.userAgent)) return;
          var k = 'pixiemap-site-lang', l = localStorage.getItem(k);
          if (!l) { l = pick(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]); localStorage.setItem(k, l); }
          if (DIRS[l]) leave(DIRS[l] + location.search + location.hash);
        } catch (e) { /* 저장소를 못 쓰는 환경 → 지금 페이지 */ } };
        try {
          var intro = /[?&]intro\\b/.test(location.search);
          if (!intro && (/pair=/.test(location.hash) || matchMedia('(display-mode: standalone)').matches)) return leave('app' + location.hash);
          if (!intro && (localStorage.getItem('pixiemap-used') === '1' || localStorage.getItem('synapse-canvas-v1'))) return leave('app' + location.hash);
          // 이 표시가 생기기 전부터 쓰던 기기: 저장소(IndexedDB)가 있는지로 판단
          if (!intro && indexedDB.databases) {
            d.className += ' checking';
            var done = function () { d.className = d.className.replace(' checking', ''); };
            setTimeout(done, 400);
            indexedDB.databases().then(function (l) {
              for (var i = 0; i < l.length; i++) if (l[i].name === 'synapse-canvas') return leave('app' + location.hash);
              done(); toLang();
            }, function () { done(); toLang(); });
            return;
          }
          toLang();
        } catch (e) { /* 저장소를 못 쓰는 환경 → 지금 페이지 */ }
      })();
    </script>`;
const SUB_SCRIPT = `    <script>document.documentElement.className += ' js';</script>`;

export function renderLanding(L) {
  const t = siteDict(L.code), up = L.dir ? '../' : '', self = url(L);
  const others = SITE_LANGS.filter(l => l !== L);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication', name: 'PixieMap', url: self, image: ORIGIN + '/og.png',
        applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Windows, iOS, Android',
        inLanguage: L.code, description: t.ldDescription,
        offers: { '@type': 'Offer', price: '0', priceCurrency: L.currency },
      },
      {
        '@type': 'FAQPage', inLanguage: L.code,
        mainEntity: t.faq.map(([q, a]) => ({ '@type': 'Question', name: plain(q), acceptedAnswer: { '@type': 'Answer', text: plain(a) } })),
      },
    ],
  };
  const ldJson = JSON.stringify(ld, null, 2).split('\n').map(s => '    ' + s).join('\n');
  // FAQ 답의 링크(privacy)는 같은 언어 페이지로
  const faq = t.faq.map(([q, a]) => `        <details>
          <summary>${q}</summary>
          <p>${a}</p>
        </details>`).join('\n');

  return `<!doctype html>
<html lang="${L.code}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${esc(t.title)}</title>
    <meta name="description" content="${esc(t.description)}" />
    <link rel="canonical" href="${self}" />
${alternates()}
    <meta name="theme-color" content="#050509" />
    <meta name="apple-mobile-web-app-title" content="PixieMap" />
    <link rel="icon" href="${up}favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="${up}apple-touch-icon.png" sizes="180x180" />
${L.dir ? '' : `
    <!-- 검색엔진 소유 확인: 등록할 때 받은 값으로 주석을 풀어 넣으세요 (DEPLOY.md 10단계)
    <meta name="google-site-verification" content="여기에-구글-값" />
    <meta name="naver-site-verification" content="여기에-네이버-값" />
    <meta name="msvalidate.01" content="여기에-빙-값" />
    -->
`}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="PixieMap" />
    <meta property="og:title" content="${esc(t.title)}" />
    <meta property="og:description" content="${esc(t.shareDescription)}" />
    <meta property="og:url" content="${self}" />
    <meta property="og:image" content="${ORIGIN}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${esc(t.ogImageAlt)}" />
    <meta property="og:locale" content="${L.og}" />
${others.map(l => `    <meta property="og:locale:alternate" content="${l.og}" />`).join('\n')}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(t.title)}" />
    <meta name="twitter:description" content="${esc(t.shareDescription)}" />
    <meta name="twitter:image" content="${ORIGIN}/og.png" />

    <script type="application/ld+json">
${ldJson}
    </script>

${L.dir ? SUB_SCRIPT : ROOT_SCRIPT}
    <link rel="stylesheet" href="/src/landing/landing.css" />
  </head>
  <body>
    <canvas id="dust" aria-hidden="true"></canvas>
    <div class="haze" aria-hidden="true"></div>
    <div class="grain" aria-hidden="true"></div>

    <header class="hero">
      <h1 class="logo"><i></i>PIXIEMAP</h1>
      <p class="tag">${t.tagline}</p>
      <a class="btn" href="${up}app">${t.start}</a>
      <a class="scroll" href="#about" aria-label="${esc(t.scrollLabel)}">scroll ↓</a>
    </header>

    <main>
      <section id="about" class="rise">
        <h2 class="sr">${t.aboutHeading}</h2>
        <p class="lead">${t.lead}</p>
        <p>${t.about}</p>
      </section>

      <figure class="shot rise">
        <img src="${up}screen.webp" width="1440" height="900" loading="lazy" decoding="async"
          alt="${esc(t.shotAlt)}" />
      </figure>

      <section class="rise">
        <h2>${t.goodHeading}</h2>
${t.good.map(g => `        <p>${g}</p>`).join('\n')}
      </section>

      <section class="rise faq">
        <h2>${t.faqHeading}</h2>
${faq}
      </section>

      <section class="rise end">
        <a class="btn" href="${up}app">${t.start}</a>
      </section>
    </main>

    <footer>
      <div class="links">
        <a href="privacy">${t.privacy}</a>
        <a href="licenses">${t.licenses}</a>
      </div>
      ${langNav(L, up, t.languages)}
    </footer>

    <script type="module" src="/src/landing/landing.ts"></script>
  </body>
</html>
`;
}

// 사이트맵: 언어별 소개·개인정보처리방침·오픈소스 라이선스 (/app은 내용 없는 캔버스라 넣지 않는다)
export function renderSitemap() {
  const entry = (L, page) => `  <url>
    <loc>${url(L, page)}</loc>
    <lastmod>${LASTMOD}</lastmod>
${SITE_LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l.code}" href="${url(l, page)}" />`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(SITE_LANGS.find(l => l.code === X_DEFAULT), page)}" />
  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- scripts/site.mjs가 만든다. /app(내용 없는 캔버스, noindex)은 넣지 않는다. 주소는 Cloudflare Pages의 확장자 없는 주소 -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${['', 'privacy', 'licenses'].flatMap(page => SITE_LANGS.map(L => entry(L, page))).join('\n')}
</urlset>
`;
}

export function outputs() {
  return [
    ...SITE_LANGS.map(L => [landingFile(L), renderLanding(L)]),
    ['public/sitemap.xml', renderSitemap()],
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  for (const [f, html] of outputs()) {
    fs.mkdirSync(path.dirname(f) || '.', { recursive: true });
    fs.writeFileSync(f, html);
    console.log('wrote', f);
  }
}
