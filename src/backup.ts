// EXPORT / IMPORT — version 2는 사진을 base64(dataURL)로 함께 담아 파일 하나로 완전 복원한다.
import { type Data, type Prefs, DEF_PREFS, PREF_KEYS, alive, normalizeData, referencedImages } from './model';
import { getImage, storeDataUrl } from './storage';
import { fetchRemoteImage } from './sync';

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

// 삭제 기록(툼스톤)은 빼고 지금 보이는 내용만 내보낸다
function stripDeleted(d: Data): Data {
  return {
    cats: d.cats.filter(alive).map(c => ({ ...c, boxes: c.boxes.filter(alive), links: c.links.filter(alive), strokes: c.strokes.filter(alive) })),
  };
}

export async function exportBackup(data: Data, prefs: Prefs, preferShare: boolean): Promise<void> {
  const clean = stripDeleted(data);
  const images: Record<string, string> = {};
  for (const id of referencedImages(clean)) {
    const b = (await getImage(id)) || (await fetchRemoteImage(id).catch(() => null));
    if (b) images[id] = await blobToDataUrl(b);
  }
  // app 값은 예전 이름 그대로 둔다 (이전 버전 앱도 이 파일을 IMPORT할 수 있게)
  const json = JSON.stringify({ app: 'synapse-canvas', version: 2, exportedAt: new Date().toISOString(), data: clean, prefs, images }, null, 1);
  const name = `pixiemap-backup-${stamp()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // 모바일은 공유 시트 우선 (파일 앱 저장, 메신저 전송 등), 안 되면 다운로드
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// 검증 실패 시 예외. version 1(사진 = src dataURL)과 version 2(사진 = images 맵) 모두 지원.
export type RawBackup = any;
// 예전 이름(synapse-canvas, dendra)과 새 이름(pixiemap)의 백업을 모두 받는다
const BACKUP_APPS = ['synapse-canvas', 'dendra', 'pixiemap'];
export function validateBackup(text: string): RawBackup {
  const o = JSON.parse(text);
  if (o && o.app != null && !BACKUP_APPS.includes(o.app)) throw new Error('bad');
  if (!o || !o.data || !Array.isArray(o.data.cats) || !o.data.cats.length) throw new Error('bad');
  return o;
}
// 확인창 이후에 호출: 사진을 기기 저장소에 넣고 현재 데이터 모델로 변환
export async function materializeBackup(o: RawBackup): Promise<{ data: Data; prefs: Prefs }> {
  const images: Record<string, string> = (o.version >= 2 && o.images) || {};
  for (const [id, src] of Object.entries(images)) await storeDataUrl(src, id);
  const data = await normalizeData(o.data, src => storeDataUrl(src));
  const prefs = { ...DEF_PREFS };
  for (const k of PREF_KEYS) if (o.prefs && k in o.prefs) (prefs as Record<string, unknown>)[k] = o.prefs[k];
  return { data, prefs };
}
