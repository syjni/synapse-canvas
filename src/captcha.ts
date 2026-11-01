import { t } from './i18n';

// Cloudflare Turnstile — 아이디 만들기·로그인·익명 로그인(기기 열쇠)에 사용.
// VITE_TURNSTILE_SITE_KEY가 없으면 CAPTCHA 없이 진행한다(Supabase 쪽에서도 꺼져 있어야 함).
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
export const TURNSTILE_SITE_KEY = env.VITE_TURNSTILE_SITE_KEY || '';

type Turnstile = {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function load(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error(t('err.captchaLoad'))); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// 위젯 하나로 토큰을 여러 번 받는다(토큰은 일회용 → 쓸 때마다 reset 후 새 토큰 대기)
export class CaptchaWidget {
  private id: string | null = null;
  private token: string | null = null;
  private waiters: ((t: string) => void)[] = [];
  constructor(private el: HTMLElement) {}

  async mount() {
    if (!TURNSTILE_SITE_KEY || this.id) return;
    await load();
    this.id = window.turnstile!.render(this.el, {
      sitekey: TURNSTILE_SITE_KEY, theme: 'dark', size: 'flexible', appearance: 'interaction-only',
      callback: (t: string) => { this.token = t; const w = this.waiters.shift(); if (w) { this.token = null; w(t); } },
      'expired-callback': () => { this.token = null; if (this.id) window.turnstile!.reset(this.id); },
    });
  }
  unmount() { if (this.id && window.turnstile) window.turnstile.remove(this.id); this.id = null; }

  // Supabase 요청 하나에 토큰 하나
  get: () => Promise<string | undefined> = async () => {
    if (!TURNSTILE_SITE_KEY) return undefined;
    await this.mount();
    const t = this.token;
    if (t) { this.token = null; window.turnstile!.reset(this.id!); return t; }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('captcha timeout')), 60000);
      this.waiters.push(tok => { clearTimeout(timer); window.turnstile!.reset(this.id!); resolve(tok); });
    });
  };
}
