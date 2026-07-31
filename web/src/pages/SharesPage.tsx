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
      <h1>Share links</h1>
      <p class="subtle">Anyone with one of these URLs can view — read only, no login.</p>

      {error && <p class="notice error">{error}</p>}

      {links === null ? (
        <p class="subtle">Loading…</p>
      ) : links.length === 0 ? (
        <p class="subtle" data-testid="no-shares">
          No active share links.
        </p>
      ) : (
        <table style="margin-top:16px" data-testid="share-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Kind</th>
              <th>Link</th>
              <th>Created by</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.token} data-testid={`share-row-${l.token}`}>
                <td>{l.target_label ?? l.target_id}</td>
                <td>{l.kind}</td>
                <td>
                  <a href={l.url} target="_blank" rel="noreferrer" data-testid={`share-url-${l.token}`}>
                    {l.url}
                  </a>
                </td>
                <td class="subtle">{l.created_by ?? '—'}</td>
                <td class="subtle">{formatTimestamp(l.created_at)}</td>
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
