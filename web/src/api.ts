export interface Collection {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  screenshot_count?: number;
}

export interface Screenshot {
  id: string;
  collection_id: string;
  r2_key: string;
  filename: string | null;
  content_type: string | null;
  width: number | null;
  height: number | null;
  source_host: string | null;
  created_at: string;
  annotation_count?: number;
  open_annotation_count?: number;
}

export interface Annotation {
  id: string;
  screenshot_id: string;
  body: string;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  author: string | null;
  resolved: boolean;
  created_at: string;
  screenshot_filename?: string | null;
}

export interface ShareLink {
  token: string;
  kind: 'collection' | 'screenshot';
  target_id: string;
  target_label: string | null;
  created_by: string | null;
  created_at: string;
  /** null = never expires. */
  expires_at: string | null;
  expired: boolean;
  url: string;
}

export interface MintedShare {
  token: string;
  url: string;
  expires_at: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, payload?.error ?? `request failed (${res.status})`);
  }
  return payload as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

export const api = {
  listCollections: () =>
    request<{ collections: Collection[] }>('/api/collections').then((r) => r.collections),

  createCollection: (name: string, description: string) =>
    request<Collection & { url: string }>('/api/collections', json('POST', { name, description })),

  getCollection: (cid: string) =>
    request<{ collection: Collection; screenshots: Screenshot[] }>(`/api/collections/${cid}`),

  updateCollection: (cid: string, patch: { name?: string; description?: string | null }) =>
    request<Collection>(`/api/collections/${cid}`, json('PATCH', patch)),

  deleteCollection: (cid: string) =>
    request<{ ok: true }>(`/api/collections/${cid}`, { method: 'DELETE' }),

  collectionAnnotations: (cid: string) =>
    request<{ annotations: Annotation[] }>(`/api/collections/${cid}/annotations`).then(
      (r) => r.annotations,
    ),

  upload: (cid: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Screenshot & { url: string }>(`/api/collections/${cid}/screenshots`, {
      method: 'POST',
      body: form,
    });
  },

  getScreenshot: (sid: string) =>
    request<{ screenshot: Screenshot; collection: Collection; annotations: Annotation[] }>(
      `/api/screenshots/${sid}`,
    ),

  moveScreenshot: (sid: string, collectionId: string) =>
    request<{ screenshot: Screenshot }>(`/api/screenshots/${sid}`, json('PATCH', { collection_id: collectionId })),

  deleteScreenshot: (sid: string) =>
    request<{ ok: true }>(`/api/screenshots/${sid}`, { method: 'DELETE' }),

  addAnnotation: (
    sid: string,
    payload: { body: string; x?: number; y?: number; w?: number; h?: number },
  ) => request<{ annotation: Annotation }>(`/api/screenshots/${sid}/annotations`, json('POST', payload)),

  updateAnnotation: (aid: string, patch: { body?: string; resolved?: boolean }) =>
    request<{ annotation: Annotation }>(`/api/annotations/${aid}`, json('PATCH', patch)),

  deleteAnnotation: (aid: string) =>
    request<{ ok: true }>(`/api/annotations/${aid}`, { method: 'DELETE' }),

  shareCollection: (cid: string, expiresInDays: number | null = null) =>
    request<MintedShare>(`/api/collections/${cid}/share`, json('POST', { expires_in_days: expiresInDays })),

  shareScreenshot: (sid: string, expiresInDays: number | null = null) =>
    request<MintedShare>(`/api/screenshots/${sid}/share`, json('POST', { expires_in_days: expiresInDays })),

  listShareLinks: () => request<{ links: ShareLink[] }>('/api/share-links').then((r) => r.links),

  revokeShareLink: (token: string) =>
    request<{ ok: true }>(`/api/share-links/${token}`, { method: 'DELETE' }),

  me: () => request<{ identity: { actor: string; kind: string } }>('/api/me'),
};

export interface PublicPayload {
  kind: 'collection' | 'screenshot';
  collection: Collection | null;
  screenshots: Screenshot[];
  annotations: Annotation[];
}

export const publicApi = {
  data: (token: string) => request<PublicPayload>(`/p/${token}/data`),
  imageUrl: (token: string, key: string) => `/p/${token}/img/${key}`,
};

export const imageUrl = (key: string) => `/img/${key}`;
