import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './index.css';
import Canvas from './Canvas';
import { loadAll } from './storage';
import type { Persisted } from './model';
import { initLang, subscribeLang, t } from './i18n';
import { syncCjkFont } from './i18n/font';

function App() {
  const [st, setSt] = useState<{ state: Persisted; fresh: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    // 언어를 먼저 정한다 (처음 실행이면 예시 상자 글도 이 언어로 만든다)
    // 창 제목도 언어에 맞게 (app.html의 제목은 한국어 기본값)
    const title = () => { document.title = t('app.docTitle'); };
    initLang().then(() => { syncCjkFont(); title(); subscribeLang(title); return loadAll(); }).then(r => {
      // 소개 페이지(/)가 "이미 쓰던 사람"을 바로 /app으로 보내기 위한 표시
      try { localStorage.setItem('pixiemap-used', '1'); } catch { /* 저장 불가 환경 */ }
      setSt(r);
    }, e => setErr(String(e && e.message ? e.message : e)));
  }, []);
  if (err) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9C8F', fontFamily: 'GalmuriMono11, monospace', fontSize: 12, padding: 24, textAlign: 'center' }}>
      {t('app.storageError', { error: err })}<br />{t('app.storageErrorHint')}
    </div>
  );
  if (!st) return null;
  return <Canvas initial={st.state} fresh={st.fresh} />;
}

createRoot(document.getElementById('root')!).render(<App />);
