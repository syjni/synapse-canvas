import { useEffect, useState } from 'react';

// 빌드 때 scripts/licenses.mjs가 만든 licenses.json을 읽어 보여 준다 (번들에 실제로 들어간 패키지만)
type Lic = { name: string; version: string; license: string; copyright: string[]; url: string; text: string };

const mono = "'GalmuriMono9',monospace";
const dim = 'rgba(217,218,240,.55)';
const pre = { margin: 0, padding: '10px 12px', background: '#05060B', border: '1px solid rgba(217,218,240,.1)', color: 'rgba(217,218,240,.72)', fontFamily: "'GalmuriMono11',monospace", fontSize: 10.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflow: 'auto', userSelect: 'text', WebkitUserSelect: 'text', touchAction: 'pan-y' } as const;

export default function Licenses({ nc }: { nc: string }) {
  const [list, setList] = useState<Lic[] | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}licenses.json`).then(r => (r.ok ? r.json() : Promise.reject())).then(setList, () => setErr(true));
  }, []);

  if (err) return <div style={{ padding: 16, fontSize: 11, color: dim, lineHeight: 1.6 }}>라이선스 목록은 빌드(npm run build)할 때 만들어집니다. 개발 서버에서는 볼 수 없습니다.</div>;
  if (!list) return <div style={{ padding: 16, fontSize: 11, color: dim }}>불러오는 중…</div>;

  const font = list.find(x => x.name === 'galmuri');
  const libs = list.filter(x => x !== font);
  const head = (t: string) => <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '.16em', color: nc }}>{t}</div>;
  const copy = (x: Lic) => (x.copyright.length ? x.copyright : ['저작권 표기는 저장소 참고']).map(c => <div key={c} style={{ color: dim, fontSize: 10.5, lineHeight: 1.5 }}>{c}</div>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '14px 16px 18px' }}>
      <div style={{ fontSize: 11, color: dim, lineHeight: 1.6 }}>이 앱에 포함된 폰트와 오픈소스 라이브러리입니다. 각 라이선스에 따라 저작권 표기와 라이선스 전문을 함께 싣습니다.</div>
      {font && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {head('FONT')}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12 }}>
            <span style={{ color: '#E9EAF7' }}>갈무리 Galmuri <span style={{ color: dim, fontSize: 10.5 }}>{font.version}</span></span>
            <span style={{ color: nc, fontFamily: mono, fontSize: 10 }}>SIL OFL 1.1</span>
          </div>
          {copy(font)}
          <a href={font.url} target="_blank" rel="noopener" style={{ color: '#B3ADFF', fontSize: 10.5, alignSelf: 'flex-start' }}>{font.url}</a>
          <pre style={pre}>{font.text}</pre>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(217,218,240,.1)' }}>
        <div style={{ background: 'rgba(6,7,13,.97)', paddingBottom: 8 }}>{head(`LIBRARIES · ${libs.length}`)}</div>
        {libs.map(x => (
          <div key={x.name} style={{ background: '#07080E', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div onClick={() => setOpen(open === x.name ? null : x.name)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, cursor: 'pointer', minHeight: 22 }}>
              <span style={{ color: '#E9EAF7', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name} <span style={{ color: dim, fontSize: 10 }}>{x.version}</span></span>
              <span style={{ flex: 'none', color: nc, fontFamily: mono, fontSize: 10 }}>{x.license} {open === x.name ? '▴' : '▾'}</span>
            </div>
            {copy(x)}
            {open === x.name && (<>
              {x.url && <a href={x.url} target="_blank" rel="noopener" style={{ color: '#B3ADFF', fontSize: 10.5, alignSelf: 'flex-start', wordBreak: 'break-all' }}>{x.url}</a>}
              <pre style={pre}>{x.text || `${x.license} — 패키지에 라이선스 파일이 없습니다.`}</pre>
            </>)}
          </div>
        ))}
      </div>
    </div>
  );
}
