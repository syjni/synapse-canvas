import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import licenses from './scripts/licenses.mjs';
import pages from './scripts/pages.mjs';

// 하위 경로에 배포할 때만 BASE_PATH=/경로/ 로 빌드 (Cloudflare Pages는 루트라 지정하지 않음)
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  // 소개 페이지(index.html → /, 언어별 en/·ja/·zh-hans/·es/ — scripts/site.mjs가 만든다)와 앱(app.html → /app).
  // Cloudflare Pages는 app.html을 /app으로 서비스한다
  build: { rollupOptions: { input: { main: 'index.html', en: 'en/index.html', ja: 'ja/index.html', 'zh-hans': 'zh-hans/index.html', es: 'es/index.html', app: 'app.html' } } },
  plugins: [
    react(),
    // 개발·미리보기 서버에서도 /app·/privacy·/licenses가 열리게 (Pages와 같은 주소)
    pages(),
    // 오픈소스 라이선스 화면용 licenses.json (폰트·서비스 워커의 workbox는 모듈 그래프 밖이라 직접 지정)
    // 퓨전 픽셀 폰트는 npm 패키지가 아니라 서브셋 파일을 동봉한다 (scripts/subset-zh-font.mjs)
    licenses(['galmuri', 'workbox-core', 'workbox-precaching', 'workbox-routing'], [{
      name: 'fusion-pixel-font', version: '2026.10.25', license: 'OFL-1.1',
      copyright: ['Copyright (c) 2022, TakWolf (https://takwolf.com)', 'Copyright (c) 2021, TakWolf (Ark Pixel Font)', 'Cubic 11 · JF Dot M+H 12 · Galmuri (included glyphs)'],
      url: 'https://github.com/TakWolf/fusion-pixel-font', textFile: 'src/fonts/fusion-pixel-LICENSE.txt',
    }]),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        // id는 바꾸지 않는다: 바꾸면 이미 설치된 앱이 다른 앱으로 취급된다
        id: 'synapse-canvas',
        name: 'PixieMap: Lo-fi Mind Map',
        short_name: 'PixieMap',
        description: '상자를 뉴런처럼 이어 생각을 정리하는 무한 캔버스',
        lang: 'ko',
        // 홈 화면 앱은 바로 캔버스(/app)로. 범위는 사이트 전체(소개·개인정보처리방침 링크도 앱 안에서)
        start_url: base + 'app',
        scope: base,
        display: 'standalone',
        // window-controls-overlay는 쓰지 않는다: Windows 설치 앱(Edge)이 페이지의 app-region/window-drag를 무시해서
        // 상단 바를 잡고 창을 끌 수 없었다. 일반 제목줄이 있어야 창을 옮길 수 있다
        display_override: ['standalone'],
        background_color: '#050509',
        theme_color: '#050509',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,webp,svg,webmanifest,json}'],
        globIgnores: ['og.png'],   // 링크 미리보기용 이미지는 앱에서 쓰지 않으므로 미리 받지 않는다
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // /app·/privacy는 미리 받아 둔 app.html·privacy.html로 연다(workbox cleanURLs). 그 외 모르는 주소는 소개 페이지
        navigateFallback: 'index.html',
      },
    }),
  ],
});
