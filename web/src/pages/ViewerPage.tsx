import { useEffect, useState } from 'preact/hooks';
import { api, imageUrl, type Annotation, type Collection, type Screenshot } from '../api';
import { navigate } from '../router';
import { formatTimestamp } from '../buckets';
import { Annotator, type Region } from '../components/Annotator';
import { CommentList } from '../components/CommentList';
import { ShareButton } from '../components/ShareButton';
import { IconArrowLeft } from '../components/icons';

export function ViewerPage({ cid, sid }: { cid: string; sid: string }) {
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [allCollections, setAllCollections] = useState<Collection[]>([]);
  const [draft, setDraft] = useState<Region | null>(null);
  const [body, setBody] = useState('');
  const [wholeBody, setWholeBody] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const data = await api.getScreenshot(sid);
    setScreenshot(data.screenshot);
    setCollection(data.collection);
    setAnnotations(data.annotations);
  }

  useEffect(() => {
    setScreenshot(null);
    refresh().catch((e) => setError(e.message));
    api.listCollections().then(setAllCollections).catch(() => setAllCollections([]));
  }, [sid]);

  async function submitRegionComment(event: Event) {
    event.preventDefault();
    if (!draft || !body.trim()) return;
    try {
      await api.addAnnotation(sid, { body: body.trim(), ...draft });
      setBody('');
      setDraft(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitWholeComment(event: Event) {
    event.preventDefault();
    if (!wholeBody.trim()) return;
    try {
      await api.addAnnotation(sid, { body: wholeBody.trim() });
      setWholeBody('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) {
    return (
      <main>
        <p class="notice error" data-testid="error">
          {error}
        </p>
      </main>
    );
  }

  if (!screenshot) {
    return (
      <main>
        <p class="subtle">Loading…</p>
      </main>
    );
  }

  const targetCid = collection?.id ?? cid;
  const open = annotations.filter((a) => !a.resolved).length;

  return (
    <main>
      <a
        class="backlink"
        href={`/c/${targetCid}`}
        data-testid="back-to-collection"
        onClick={(e) => {
          e.preventDefault();
          navigate(`/c/${targetCid}`);
        }}
      >
        <IconArrowLeft />
        {collection?.name ?? 'Collection'}
      </a>

      <div class="page-head">
        <div class="titles">
          <h1 data-testid="screenshot-title">{screenshot.filename ?? screenshot.id}</h1>
          <p class="subtle">
            {screenshot.width && screenshot.height ? `${screenshot.width}×${screenshot.height} · ` : ''}
            {formatTimestamp(screenshot.created_at)}
            {screenshot.source_host ? ` · from ${screenshot.source_host}` : ''}
          </p>
        </div>
        <div class="actions">
          <ShareButton
            testId="share-screenshot"
            variant="primary"
            subject="this screenshot and its comments"
            onShare={(days) => api.shareScreenshot(sid, days)}
          />
        </div>
      </div>

      <div class="viewer">
        <div class="stack">
          <Annotator
            src={imageUrl(screenshot.r2_key)}
            alt={screenshot.filename ?? screenshot.id}
            annotations={annotations}
            activeId={activeId}
            draft={draft}
            onSelect={setActiveId}
            onDraft={setDraft}
            downloadName={screenshot.filename ?? `${screenshot.id}.png`}
          />
          <p class="hint">
            <span>
              <kbd>Click</kbd> the image to drop a pin, or <kbd>drag</kbd> to mark a region.{' '}
              <kbd>Scroll</kbd> to zoom; switch to Pan to move around without commenting.
            </span>
          </p>

          {draft && (
            <form class="card panel stack" onSubmit={submitRegionComment} data-testid="region-composer">
              <strong>
                {draft.w === 0 && draft.h === 0 ? 'Pin' : 'Region'} comment
              </strong>
              <textarea
                placeholder="What's wrong here?"
                aria-label="Comment"
                value={body}
                data-testid="region-comment-input"
                onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
              />
              <div class="row">
                <button class="primary" type="submit" data-testid="region-comment-submit" disabled={!body.trim()}>
                  Add comment
                </button>
                <button type="button" onClick={() => { setDraft(null); setBody(''); }} data-testid="region-comment-cancel">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        <div class="stack">
          <form class="card stack" onSubmit={submitWholeComment} data-testid="whole-composer">
            <strong>Comment on the whole image</strong>
            <textarea
              placeholder="General feedback"
              aria-label="Whole-image comment"
              value={wholeBody}
              data-testid="whole-comment-input"
              onInput={(e) => setWholeBody((e.target as HTMLTextAreaElement).value)}
            />
            <button class="primary" type="submit" data-testid="whole-comment-submit" disabled={!wholeBody.trim()}>
              Add comment
            </button>
          </form>

          <h2 style="margin:12px 0 0">
            Comments (<span data-testid="comment-count">{annotations.length}</span>)
            {annotations.length > 0 && open !== annotations.length ? ` · ${open} open` : ''}
          </h2>
          <CommentList
            annotations={annotations}
            activeId={activeId}
            onSelect={setActiveId}
            onEdit={async (id, next) => {
              await api.updateAnnotation(id, { body: next });
              await refresh();
            }}
            onResolve={async (id, resolved) => {
              await api.updateAnnotation(id, { resolved });
              await refresh();
            }}
            onDelete={async (id) => {
              await api.deleteAnnotation(id);
              await refresh();
            }}
          />

          <div class="card stack" style="margin-top:12px">
            <strong>Manage</strong>
            <label class="subtle" for="move-select">
              Move to collection
            </label>
            <select
              id="move-select"
              data-testid="move-select"
              value={targetCid}
              onChange={async (e) => {
                const next = (e.target as HTMLSelectElement).value;
                if (next === targetCid) return;
                await api.moveScreenshot(sid, next);
                navigate(`/c/${next}/s/${sid}`);
                await refresh();
              }}
            >
              {allCollections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              class="danger small"
              style="align-self:flex-start"
              data-testid="delete-screenshot"
              onClick={async () => {
                if (!confirm('Delete this screenshot?')) return;
                await api.deleteScreenshot(sid);
                navigate(`/c/${targetCid}`);
              }}
            >
              Delete screenshot
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
