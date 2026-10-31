import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './index.css';
import Canvas from './Canvas';
import { loadAll } from './storage';
import type { Persisted } from './model';

function App() {
  const [st, setSt] = useState<{ state: Persisted; fresh: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadAll().then(r => {
      // 소개 페이지(/)가 "이미 쓰던 사람"을 바로 /app으로 보내기 위한 표시
      try { localStorage.setItem('pixiemap-used', '1'); } catch { /* 저장 불가 환경 */ }
      setSt(r);
    }, e => setErr(String(e && e.message ? e.message : e)));
  }, []);
  if (err) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9C8F', fontFamily: 'GalmuriMono11, monospace', fontSize: 12, padding: 24, textAlign: 'center' }}>
      기기 저장소를 열 수 없습니다 — {err}<br />개인정보 보호 모드에서는 저장소가 막혀 있을 수 있어요.
    </div>
  );
  if (!st) return null;
  return <Canvas initial={st.state} fresh={st.fresh} />;
}

createRoot(document.getElementById('root')!).render(<App />);
