import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { stepDust, DUST, type Dust } from '../src/landing/dust';

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

describe('검색엔진 설정', () => {
  const landing = fs.readFileSync('index.html', 'utf8');
  it('FAQ 구조화 데이터의 질문·답이 페이지에 보이는 글과 같다', () => {
    const ld = JSON.parse(landing.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const faq = ld['@graph'].find((x: { '@type': string }) => x['@type'] === 'FAQPage');
    const app = ld['@graph'].find((x: { '@type': string }) => x['@type'] === 'SoftwareApplication');
    expect(app).toMatchObject({ name: 'PixieMap', applicationCategory: 'ProductivityApplication', operatingSystem: 'Web, Windows, iOS, Android', offers: { price: '0', priceCurrency: 'KRW' } });
    const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const shown = [...landing.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map(m => [text(m[1]), text(m[2])]);
    expect(faq.mainEntity.map((q: { name: string; acceptedAnswer: { text: string } }) => [q.name, q.acceptedAnswer.text])).toEqual(shown);
    expect(shown.length).toBeGreaterThanOrEqual(4);
  });
  it('/app은 noindex이고 사이트맵에 없으며, robots.txt가 사이트맵을 알려 준다', () => {
    expect(fs.readFileSync('app.html', 'utf8')).toMatch(/<meta name="robots" content="noindex"/);
    const sm = fs.readFileSync('public/sitemap.xml', 'utf8');
    expect([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual(['https://pixiemap.pages.dev/', 'https://pixiemap.pages.dev/privacy', 'https://pixiemap.pages.dev/licenses']);
    expect(fs.readFileSync('public/robots.txt', 'utf8')).toMatch(/Sitemap: https:\/\/pixiemap\.pages\.dev\/sitemap\.xml/);
  });
  it('소개 페이지 제목·설명에 핵심 표현이 자연스럽게 들어 있다', () => {
    const desc = landing.match(/<meta name="description" content="([^"]+)"/)![1];
    for (const w of ['감성', '예쁜', '무료', '마인드맵', '로파이']) expect(desc).toContain(w);
    expect(landing).toMatch(/<link rel="canonical" href="https:\/\/pixiemap\.pages\.dev\/"/);
    expect(landing).toMatch(/<meta property="og:locale" content="ko_KR"/);
  });
});
