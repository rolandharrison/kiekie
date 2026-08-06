export interface ClientConfig {
  apiBase: string;
  webBase: string;
  clientId?: string;
  clientSecret?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thin wrapper around the Worker API. Cloudflare is the source of truth — there
 * is no local state here, so every machine sees the same collections.
 */
export class KiekieClient {
  constructor(private config: ClientConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.config.clientId && this.config.clientSecret) {
      headers['CF-Access-Client-Id'] = this.config.clientId;
      headers['CF-Access-Client-Secret'] = this.config.clientSecret;
    }
    return headers;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.config.apiBase}${path}`, {
      ...init,
      headers: this.headers(init.headers as Record<string, string> | undefined),
    });
    const text = await res.text();
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!res.ok) {
      throw new ApiError(res.status, payload?.error ?? `${init.method ?? 'GET'} ${path} failed (${res.status})`);
    }
    return payload as T;
  }

  private json(method: string, body: unknown): RequestInit {
    return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  collectionUrl(cid: string) {
    return `${this.config.webBase}/c/${cid}`;
  }

  screenshotUrl(cid: string, sid: string) {
    return `${this.config.webBase}/c/${cid}/s/${sid}`;
  }

  createCollection(name: string, description?: string) {
    return this.request<{ id: string; name: string; description: string | null }>(
      '/api/collections',
      this.json('POST', { name, description: description ?? '' }),
    );
  }

  updateCollection(id: string, patch: { name?: string; description?: string }) {
    return this.request<{ id: string; name: string; description: string | null }>(
      `/api/collections/${id}`,
      this.json('PATCH', patch),
    );
  }

  listCollections() {
    return this.request<{
      collections: {
        id: string;
        name: string;
        description: string | null;
        screenshot_count: number;
        updated_at: string;
      }[];
    }>('/api/collections');
  }

  getCollection(id: string) {
    return this.request<{
      collection: { id: string; name: string };
      screenshots: {
        id: string;
        filename: string | null;
        description: string | null;
        created_at: string;
        annotation_count: number;
        width: number | null;
        height: number | null;
      }[];
    }>(`/api/collections/${id}`);
  }

  async addScreenshot(
    collectionId: string,
    bytes: Uint8Array,
    filename: string,
    sourceHost: string,
    description?: string,
  ) {
    const form = new FormData();
    form.append('file', new Blob([bytes]), filename);
    form.append('filename', filename);
    form.append('source_host', sourceHost);
    if (description) form.append('description', description);
    return this.request<{ id: string; collection_id: string; width: number | null; height: number | null }>(
      `/api/collections/${collectionId}/screenshots`,
      { method: 'POST', body: form },
    );
  }

  getAnnotations(screenshotId: string) {
    return this.request<{ annotations: Annotation[] }>(`/api/screenshots/${screenshotId}/annotations`);
  }

  getCollectionAnnotations(collectionId: string) {
    return this.request<{ annotations: (Annotation & { screenshot_filename: string | null })[] }>(
      `/api/collections/${collectionId}/annotations`,
    );
  }
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
}
