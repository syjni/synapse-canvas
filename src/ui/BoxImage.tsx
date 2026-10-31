import { useEffect, useState } from 'react';
import { getImage } from '../storage';
import { fetchRemoteImage } from '../sync';

// imageId → objectURL 캐시 (같은 사진을 여러 번 그려도 Blob을 한 번만 읽는다)
const urls = new Map<string, string>();

export function BoxImage({ id }: { id?: string }) {
  const [url, setUrl] = useState(id ? urls.get(id) : undefined);
  useEffect(() => {
    if (!id) return;
    if (urls.has(id)) { setUrl(urls.get(id)); return; }
    let live = true;
    // 이 기기에 없으면(다른 기기에서 추가한 사진) 동기화 서버에서 받아 온다
    getImage(id).then(b => b || fetchRemoteImage(id)).then(b => {
      if (!b) return;
      const u = URL.createObjectURL(b);
      urls.set(id, u);
      if (live) setUrl(u);
    }).catch(() => { /* 사진을 못 읽으면 빈 칸으로 둔다 */ });
    return () => { live = false; };
  }, [id]);
  const style = { flex: 1, minHeight: 0, width: '100%', objectFit: 'cover' as const, display: 'block', filter: 'contrast(1.05) saturate(.9)' };
  if (!url) return <div style={{ ...style, background: 'rgba(217,218,240,.04)' }} />;
  return <img src={url} draggable={false} alt="" style={style} />;
}
