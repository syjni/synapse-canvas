import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import licenses from './scripts/licenses.mjs';

// 하위 경로에 배포할 때만 BASE_PATH=/경로/ 로 빌드 (Cloudflare Pages는 루트라 지정하지 않음)
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    // 오픈소스 라이선스 화면용 licenses.json (폰트·서비스 워커의 workbox는 모듈 그래프 밖이라 직접 지정)
    licenses(['galmuri', 'workbox-core', 'workbox-precaching', 'workbox-routing']),
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
        start_url: '.',
        scope: '.',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest,json}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
