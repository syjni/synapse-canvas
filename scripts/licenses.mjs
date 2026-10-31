// 빌드할 때 번들에 실제로 들어간 npm 패키지의 라이선스를 모아 licenses.json으로 내보낸다 (설정 → 오픈소스 라이선스).
// 패키지마다 이름·버전·라이선스 종류·저작권 줄·라이선스 전문을 담는다.
import fs from 'node:fs';
import path from 'node:path';

const NM = '/node_modules/';

// 모듈 경로 → 그 모듈이 속한 패키지 폴더 (중첩 node_modules면 가장 안쪽)
function pkgDir(id) {
  const p = id.replace(/\0/g, '').split('?')[0].replace(/\\/g, '/');
  const i = p.lastIndexOf(NM);
  if (i < 0) return null;
  const parts = p.slice(i + NM.length).split('/');
  const name = parts[0].startsWith('@') ? parts[0] + '/' + parts[1] : parts[0];
  return p.slice(0, i + NM.length) + name;
}

function licenseText(dir) {
  // 번역본(ofl-ko.md 등)보다 원문을 고르도록 이름이 짧은 것부터
  const f = fs.readdirSync(dir).filter(n => /^(licen[sc]e|copying|ofl)([.-]|$)/i.test(n)).sort((a, b) => a.length - b.length)[0];
  return f ? fs.readFileSync(path.join(dir, f), 'utf8').replace(/&copy;/g, '©').trim() : '';
}

function repoUrl(r) {
  const u = typeof r === 'string' ? r : r?.url;
  if (!u) return '';
  if (/^[\w-]+\/[\w.-]+$/.test(u)) return 'https://github.com/' + u;
  return u.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

function info(dir) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const text = licenseText(dir);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => /^(copyright\s+(\(c\)|©|\d{4})|(\(c\)|©)\s*\d{4})/i.test(l));   // 본문 속 'copyright notice…' 같은 문장은 제외
  const author = typeof p.author === 'string' ? p.author : p.author?.name;
  return {
    name: p.name,
    version: p.version,
    license: (typeof p.license === 'string' ? p.license : p.license?.type) || 'UNKNOWN',
    copyright: [...new Set(lines)].length ? [...new Set(lines)] : author ? ['Copyright (c) ' + author] : [],
    url: p.homepage || repoUrl(p.repository),
    text,
  };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// /licenses 페이지 (개인정보처리방침과 같은 모양)
function page(list) {
  const items = list.map(x => `
  <section>
    <h2>${esc(x.name)} <span class="v">${esc(x.version)} · ${esc(x.license)}</span></h2>
    ${x.copyright.map(c => `<p class="c">${esc(c)}</p>`).join('')}
    ${x.url ? `<p class="c"><a href="${esc(x.url)}" rel="noopener">${esc(x.url)}</a></p>` : ''}
    ${x.text ? `<details><summary>라이선스 전문</summary><pre>${esc(x.text)}</pre></details>` : ''}
  </section>`).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>오픈소스 라이선스 — PixieMap</title>
<meta name="description" content="무료 로파이 마인드맵 PixieMap에 쓰인 갈무리 폰트와 오픈소스 라이브러리의 저작권·라이선스 전문입니다.">
<link rel="canonical" href="https://pixiemap.pages.dev/licenses">
<meta name="theme-color" content="#050509">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<style>
  :root { --accent: #6DB6FF; --fg: #D9DAF0; --dim: rgba(217,218,240,.6); }
  html, body { margin: 0; background: #050509; color: var(--fg); }
  body { font: 15px/1.75 system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; padding: max(24px, env(safe-area-inset-top)) 16px 48px; }
  main { max-width: 680px; margin: 0 auto; }
  h1 { font-size: 22px; color: #fff; margin: 8px 0 4px; letter-spacing: .02em; }
  h2 { font-size: 15px; color: var(--accent); margin: 28px 0 4px; letter-spacing: .04em; }
  .v { color: var(--dim); font-size: 12px; letter-spacing: 0; }
  .meta, .c { color: var(--dim); font-size: 13px; margin: 2px 0; overflow-wrap: anywhere; }
  .logo { display: inline-flex; align-items: center; gap: 9px; color: var(--accent); font-size: 12px; letter-spacing: .18em; text-decoration: none; }
  .logo i { width: 8px; height: 8px; background: var(--accent); box-shadow: 0 0 10px var(--accent); display: inline-block; }
  a { color: #B3ADFF; }
  summary { cursor: pointer; color: var(--dim); font-size: 13px; margin-top: 6px; }
  pre { white-space: pre-wrap; font-size: 12px; line-height: 1.6; color: var(--dim); background: rgba(217,218,240,.04); padding: 12px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
  <a class="logo" href="./"><i></i>PIXIEMAP</a>
  <h1>오픈소스 라이선스</h1>
  <p class="meta">PixieMap은 아래 폰트와 오픈소스 소프트웨어를 사용합니다. 각 저작권자에게 감사드립니다.</p>
  ${items}
  <p class="meta" style="margin-top:32px"><a href="./">PixieMap 소개</a> · <a href="privacy">개인정보처리방침</a></p>
</main>
</body>
</html>
`;
}

// extra: 모듈 그래프로는 안 잡히는 패키지 (CSS에서 쓰는 폰트, 서비스 워커에 들어가는 workbox)
export default function licenses(extra = []) {
  return {
    name: 'collect-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      const dirs = new Set();
      for (const f of Object.values(bundle)) {
        const ids = f.type === 'chunk' ? f.moduleIds || Object.keys(f.modules || {}) : (f.originalFileNames || []).map(n => path.resolve(n));
        for (const id of ids) { const d = pkgDir(id); if (d) dirs.add(d); }
      }
      for (const n of extra) {
        const d = path.resolve('node_modules', n).replace(/\\/g, '/');
        if (fs.existsSync(path.join(d, 'package.json'))) dirs.add(d);
      }
      const byName = new Map();
      for (const d of dirs) { const x = info(d); byName.set(x.name, x); }
      const list = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(list) });
      // 같은 내용을 검색엔진도 읽을 수 있는 정적 페이지로 (/licenses)
      this.emitFile({ type: 'asset', fileName: 'licenses.html', source: page(list) });
    },
  };
}
