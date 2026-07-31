import { useEffect, useRef, useState } from 'preact/hooks';
import { api, imageUrl, type Collection, type Screenshot } from '../api';
import { formatTimestamp, groupByBucket } from '../buckets';
import { navigate } from '../router';
import { ShareButton } from '../components/ShareButton';
import { IconArrowLeft, IconUpload } from '../components/icons';

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
        <p style="margin-top:14px">
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
            All collections
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
  const total = screenshots.length;

  return (
    <main>
      <a
        class="backlink"
        href="/"
        onClick={(e) => { e.preventDefault(); navigate('/'); }}
        data-testid="back-to-collections"
      >
        <IconArrowLeft />
        All collections
      </a>

      <div class="page-head">
        <div class="titles">
          <h1 data-testid="collection-title">{collection.name}</h1>
          <p class="subtle" data-testid="collection-description-text">
            {collection.description || 'No description'}
          </p>
          <p class="subtle" style="margin:4px 0 0">
            {total} screenshot{total === 1 ? '' : 's'}
          </p>
        </div>
        <div class="actions">
          <ShareButton testId="share-collection" onShare={(days) => api.shareCollection(cid, days)} />
        </div>
      </div>

      <form class="card panel row" onSubmit={upload} data-testid="upload-form">
        <input
          type="file"
          accept="image/*"
          ref={fileRef}
          aria-label="Screenshot file"
          data-testid="upload-input"
          style="flex:1;min-width:180px"
        />
        <button class="primary" type="submit" data-testid="upload-submit" disabled={uploading}>
          <IconUpload />
          {uploading ? 'Uploading…' : 'Upload screenshot'}
        </button>
      </form>

      {screenshots.length === 0 ? (
        <div class="empty" style="margin-top:24px" data-testid="no-screenshots">
          No screenshots in this collection yet.
        </div>
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
                      title={`${s.annotation_count ?? 0} comment(s)`}
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
