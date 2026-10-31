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
    },
  };
}
