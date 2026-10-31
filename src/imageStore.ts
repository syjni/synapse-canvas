// 서버 사진 저장소. 동기화 코드는 이 인터페이스만 쓴다.
// 나중에 Cloudflare R2 등으로 바꿀 때는 이 파일의 구현(createImageStore)만 바꾸면 된다.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ImageStore {
  put(vaultId: string, imageId: string, blob: Blob): Promise<void>;
  get(vaultId: string, imageId: string): Promise<Blob | null>;
  exists(vaultId: string, imageIds: string[]): Promise<Set<string>>;
  delete(vaultId: string, imageIds: string[]): Promise<void>;
  deleteAll(vaultId: string): Promise<void>;
}

const BUCKET = 'images';
const path = (vaultId: string, imageId: string) => `${vaultId}/${imageId}.jpg`;

// Supabase Storage 구현: 비공개 버킷 'images', 경로 {vault_id}/{imageId}.jpg (schema.sql의 정책과 짝)
export function createImageStore(sb: SupabaseClient): ImageStore {
  const listAll = async (vaultId: string) => {
    const names: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.storage.from(BUCKET).list(vaultId, { limit: 1000, offset });
      if (error) throw error;
      names.push(...data.map(o => o.name));
      if (data.length < 1000) break;
    }
    return names;
  };
  return {
    async put(vaultId, imageId, blob) {
      const { error } = await sb.storage.from(BUCKET).upload(path(vaultId, imageId), blob, { contentType: blob.type || 'image/jpeg', upsert: true });
      if (error) throw error;
    },
    async get(vaultId, imageId) {
      const { data, error } = await sb.storage.from(BUCKET).download(path(vaultId, imageId));
      if (error) return null;
      return data;
    },
    async exists(vaultId, imageIds) {
      const want = new Set(imageIds);
      const have = new Set<string>();
      for (const n of await listAll(vaultId)) { const id = n.replace(/\.jpg$/, ''); if (want.has(id)) have.add(id); }
      return have;
    },
    async delete(vaultId, imageIds) {
      for (let i = 0; i < imageIds.length; i += 100) {
        const { error } = await sb.storage.from(BUCKET).remove(imageIds.slice(i, i + 100).map(id => path(vaultId, id)));
        if (error) throw error;
      }
    },
    async deleteAll(vaultId) {
      const names = await listAll(vaultId);
      for (let i = 0; i < names.length; i += 100) {
        const { error } = await sb.storage.from(BUCKET).remove(names.slice(i, i + 100).map(n => `${vaultId}/${n}`));
        if (error) throw error;
      }
    },
  };
}
