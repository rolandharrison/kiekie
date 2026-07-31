import { useEffect, useState } from 'preact/hooks';
import { api, type ShareLink } from '../api';
import { formatTimestamp } from '../buckets';

export function SharesPage() {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLinks(await api.listShareLinks());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  return (
    <main>
      <div class="page-head">
        <div class="titles">
          <h1>Share links</h1>
          <p class="subtle">
            Anyone with one of these URLs can view — read only, no login. Expired links stay listed
            until you revoke them, so you can see what you shared.
          </p>
        </div>
      </div>

      {error && <p class="notice error">{error}</p>}

      {links === null ? (
        <p class="subtle">Loading…</p>
      ) : links.length === 0 ? (
        <div class="empty" data-testid="no-shares">
          No active share links.
        </div>
      ) : (
        // Below 720px the CSS turns each row into a labelled card, which is what
        // the data-label attributes are for — a seven-column table cannot fit.
        <table data-testid="share-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Kind</th>
              <th>Link</th>
              <th>Created by</th>
              <th>Created</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.token} data-testid={`share-row-${l.token}`} data-expired={l.expired ? 'true' : 'false'}>
                <td data-label="Target">{l.target_label ?? l.target_id}</td>
                <td data-label="Kind">
                  <span class="kind-tag">{l.kind}</span>
                </td>
                <td data-label="Link" class="link">
                  <a href={l.url} target="_blank" rel="noreferrer" data-testid={`share-url-${l.token}`}>
                    {l.url}
                  </a>
                </td>
                <td data-label="Created by" class="subtle">
                  {l.created_by ?? '—'}
                </td>
                <td data-label="Created" class="subtle">
                  {formatTimestamp(l.created_at)}
                </td>
                <td data-label="Expires" class="subtle" data-testid={`share-expiry-${l.token}`}>
                  {l.expires_at === null ? (
                    'Never'
                  ) : l.expired ? (
                    <span class="expired-tag">Expired {formatTimestamp(l.expires_at)}</span>
                  ) : (
                    formatTimestamp(l.expires_at)
                  )}
                </td>
                <td>
                  <button
                    class="small danger"
                    data-testid={`revoke-${l.token}`}
                    onClick={async () => {
                      await api.revokeShareLink(l.token);
                      await refresh();
                    }}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
