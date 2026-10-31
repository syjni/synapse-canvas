import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 하위 경로에 배포할 때만 BASE_PATH=/경로/ 로 빌드 (Cloudflare Pages는 루트라 지정하지 않음)
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        id: 'synapse-canvas',
        name: 'Synapse Canvas',
        short_name: 'Synapse',
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
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
});
