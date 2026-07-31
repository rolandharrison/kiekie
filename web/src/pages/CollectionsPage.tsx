import { useEffect, useState } from 'preact/hooks';
import { api, type Collection } from '../api';
import { navigate } from '../router';
import { formatTimestamp } from '../buckets';
import { ShareButton } from '../components/ShareButton';

export function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  async function refresh() {
    setCollections(await api.listCollections());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function create(event: Event) {
    event.preventDefault();
    setError(null);
    try {
      await api.createCollection(name.trim(), description.trim());
      setName('');
      setDescription('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main>
      <h1>Collections</h1>
      <p class="subtle">Most recently updated first.</p>

      {error && (
        <p class="notice error" data-testid="error">
          {error}
        </p>
      )}

      <form class="card stack" style="margin-top:16px" onSubmit={create} data-testid="new-collection-form">
        <div class="row">
          <input
            type="text"
            placeholder="Collection name"
            data-testid="collection-name"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            style="flex:1;min-width:200px"
          />
          <input
            type="text"
            placeholder="What is this collection for?"
            data-testid="collection-description"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
            style="flex:2;min-width:240px"
          />
          <button class="primary" type="submit" data-testid="create-collection" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>

      {collections === null ? (
        <p class="subtle" style="margin-top:20px">
          Loading…
        </p>
      ) : collections.length === 0 ? (
        <p class="subtle" style="margin-top:20px" data-testid="no-collections">
          No collections yet — create one above.
        </p>
      ) : (
        <div class="collection-list" data-testid="collection-list">
          {collections.map((c) => (
            <div class="card collection-item" key={c.id} data-testid={`collection-card-${c.id}`}>
              <div class="meta">
                {editing === c.id ? (
                  <div class="stack">
                    <input
                      type="text"
                      value={editName}
                      data-testid="edit-name"
                      onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                    />
                    <input
                      type="text"
                      value={editDescription}
                      data-testid="edit-description"
                      onInput={(e) => setEditDescription((e.target as HTMLInputElement).value)}
                    />
                    <div class="row">
                      <button
                        class="primary small"
                        data-testid="edit-save"
                        onClick={async () => {
                          await api.updateCollection(c.id, {
                            name: editName.trim(),
                            description: editDescription.trim() || null,
                          });
                          setEditing(null);
                          await refresh();
                        }}
                      >
                        Save
                      </button>
                      <button class="small" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <a class="name" href={`/c/${c.id}`} onClick={(e) => { e.preventDefault(); navigate(`/c/${c.id}`); }}>
                      {c.name}
                    </a>
                    <div class="desc" data-testid={`collection-desc-${c.id}`}>
                      {c.description || <em>no description</em>}
                    </div>
                    <div class="subtle" style="margin-top:4px">
                      <span data-testid={`collection-count-${c.id}`}>{c.screenshot_count ?? 0}</span> screenshot
                      {(c.screenshot_count ?? 0) === 1 ? '' : 's'} · updated {formatTimestamp(c.updated_at)}
                    </div>
                  </>
                )}
              </div>

              <div class="stack" style="align-items:flex-end">
                <div class="row">
                  <button
                    class="small"
                    data-testid={`edit-collection-${c.id}`}
                    onClick={() => {
                      setEditing(c.id);
                      setEditName(c.name);
                      setEditDescription(c.description ?? '');
                    }}
                  >
                    Edit
                  </button>
                  <button
                    class="small danger"
                    data-testid={`delete-collection-${c.id}`}
                    onClick={async () => {
                      if (!confirm(`Delete "${c.name}" and all of its screenshots?`)) return;
                      await api.deleteCollection(c.id);
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
                <ShareButton testId={`share-collection-${c.id}`} onShare={() => api.shareCollection(c.id)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
