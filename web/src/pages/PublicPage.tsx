import { useEffect, useState } from 'preact/hooks';
import { publicApi, type PublicPayload, type Screenshot } from '../api';
import { formatTimestamp, groupByBucket } from '../buckets';
import { Annotator } from '../components/Annotator';
import { CommentList } from '../components/CommentList';
import { Logo } from '../components/Logo';
import { IconArrowLeft, IconEye } from '../components/icons';

/** Header for share pages. There is no nav: a visitor has no other page to go to. */
function PublicHeader() {
  return (
    <header class="public-head">
      <Logo />
      <div class="spacer" style="flex:1" />
      <span class="readonly-pill">
        <IconEye />
        Read only
      </span>
    </header>
  );
}

/**
 * Read-only viewer for `/p/{token}` links. There is no composer and no write
 * path here — the server also refuses writes on these routes, so this is
 * presentation, not the security boundary.
 */
export function PublicPage({ token, sid }: { token: string; sid?: string }) {
  const [data, setData] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(sid ?? null);

  useEffect(() => {
    publicApi
      .data(token)
      .then((payload) => {
        setData(payload);
        if (!sid && payload.kind === 'screenshot') setSelected(payload.screenshots[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <>
        <PublicHeader />
        <main>
          <div class="page-head">
            <div class="titles">
              <h1>Not available</h1>
            </div>
          </div>
          <p class="notice error" data-testid="public-error">
            {error}
          </p>
        </main>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PublicHeader />
        <main>
          <p class="subtle">Loading…</p>
        </main>
      </>
    );
  }

  const current: Screenshot | null =
    data.screenshots.find((s) => s.id === selected) ??
    (data.kind === 'screenshot' ? data.screenshots[0] ?? null : null);

  return (
    <>
      <PublicHeader />
      <main data-testid="public-page">
        <div class="page-head">
          <div class="titles">
            <h1 data-testid="public-title">{data.collection?.name ?? 'Shared screenshot'}</h1>
            {data.collection?.description && <p class="subtle">{data.collection.description}</p>}
            <p class="subtle" data-testid="public-readonly-note" style="margin:4px 0 0">
              Shared, read-only view.
            </p>
          </div>
        </div>

        {current ? (
          <div class="viewer">
            <div class="stack">
              {data.kind === 'collection' && (
                <a
                  class="backlink"
                  href="#"
                  style="margin:0;align-self:flex-start"
                  data-testid="public-back"
                  onClick={(e) => {
                    e.preventDefault();
                    setSelected(null);
                  }}
                >
                  <IconArrowLeft />
                  All screenshots
                </a>
              )}
              <Annotator
                src={publicApi.imageUrl(token, current.r2_key)}
                alt={current.filename ?? current.id}
                annotations={data.annotations.filter((a) => a.screenshot_id === current.id)}
                readOnly
                downloadName={current.filename ?? `${current.id}.png`}
              />
            </div>
            <div class="stack">
              <h2 style="margin:0">Comments</h2>
              <CommentList
                annotations={data.annotations.filter((a) => a.screenshot_id === current.id)}
                readOnly
              />
            </div>
          </div>
        ) : (
          groupByBucket(data.screenshots).map((bucket) => (
            <section key={bucket.label}>
              <h2>{bucket.label}</h2>
              <div class="grid">
                {bucket.items.map((s) => {
                  const count = data.annotations.filter((a) => a.screenshot_id === s.id).length;
                  return (
                    <a
                      key={s.id}
                      class="thumb"
                      href="#"
                      data-testid={`public-screenshot-${s.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setSelected(s.id);
                      }}
                    >
                      <img src={publicApi.imageUrl(token, s.r2_key)} alt={s.filename ?? s.id} />
                      <div class="cap">
                        <span class="fn">{s.filename ?? s.id}</span>
                        <span class={`badge${count === 0 ? ' zero' : ''}`}>{count}</span>
                      </div>
                      <div class="cap subtle" style="padding-top:0">
                        {formatTimestamp(s.created_at)}
                      </div>
                    </a>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </>
  );
}
