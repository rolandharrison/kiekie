import { useEffect, useRef, useState } from 'preact/hooks';
import { api, imageUrl, type Collection, type Screenshot } from '../api';
import { formatTimestamp, groupByBucket } from '../buckets';
import { navigate } from '../router';
import { ShareButton } from '../components/ShareButton';

export function CollectionPage({ cid }: { cid: string }) {
  const [collection, setCollection] = useState<Collection | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const data = await api.getCollection(cid);
    setCollection(data.collection);
    setScreenshots(data.screenshots);
  }

  useEffect(() => {
    setCollection(null);
    refresh().catch((e) => setError(e.message));
  }, [cid]);

  async function upload(event: Event) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await api.upload(cid, file);
      if (fileRef.current) fileRef.current.value = '';
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (error) {
    return (
      <main>
        <p class="notice error" data-testid="error">
          {error}
        </p>
        <p>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            ← All collections
          </a>
        </p>
      </main>
    );
  }

  if (!collection) {
    return (
      <main>
        <p class="subtle">Loading…</p>
      </main>
    );
  }

  const buckets = groupByBucket(screenshots);

  return (
    <main>
      <p>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} data-testid="back-to-collections">
          ← All collections
        </a>
      </p>

      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <h1 data-testid="collection-title">{collection.name}</h1>
          <p class="subtle" data-testid="collection-description-text">
            {collection.description || 'No description'}
          </p>
        </div>
        <ShareButton testId="share-collection" onShare={() => api.shareCollection(cid)} />
      </div>

      <form class="card row" style="margin-top:16px" onSubmit={upload} data-testid="upload-form">
        <input type="file" accept="image/*" ref={fileRef} data-testid="upload-input" style="flex:1" />
        <button class="primary" type="submit" data-testid="upload-submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload screenshot'}
        </button>
      </form>

      {screenshots.length === 0 ? (
        <p class="subtle" style="margin-top:24px" data-testid="no-screenshots">
          No screenshots in this collection yet.
        </p>
      ) : (
        buckets.map((bucket) => (
          <section key={bucket.label} data-testid={`bucket-${bucket.label.replace(/\s+/g, '-').toLowerCase()}`}>
            <h2>{bucket.label}</h2>
            <div class="grid">
              {bucket.items.map((s) => (
                <a
                  key={s.id}
                  class="thumb"
                  href={`/c/${cid}/s/${s.id}`}
                  data-testid={`screenshot-${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/c/${cid}/s/${s.id}`);
                  }}
                >
                  <img src={imageUrl(s.r2_key)} alt={s.filename ?? s.id} loading="lazy" />
                  <div class="cap">
                    <span class="fn">{s.filename ?? s.id}</span>
                    <span
                      class={`badge${(s.annotation_count ?? 0) === 0 ? ' zero' : ''}`}
                      data-testid={`annotation-count-${s.id}`}
                    >
                      {s.annotation_count ?? 0}
                    </span>
                  </div>
                  <div class="cap subtle" style="padding-top:0">
                    {formatTimestamp(s.created_at)}
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
