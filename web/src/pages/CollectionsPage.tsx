import { useEffect, useState } from 'preact/hooks';
import { api, type Collection } from '../api';
import { navigate } from '../router';
import { formatTimestamp } from '../buckets';
import { ShareButton } from '../components/ShareButton';
import { Dialog } from '../components/Dialog';
import { IconPlus } from '../components/icons';

export function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [creating, setCreating] = useState(false);
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

  function openCreate() {
    setName('');
    setDescription('');
    setError(null);
    setCreating(true);
  }

  async function create(event: Event) {
    event.preventDefault();
    setError(null);
    try {
      await api.createCollection(name.trim(), description.trim());
      setCreating(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main>
      <div class="page-head">
        <div class="titles">
          <h1>Collections</h1>
          <p class="subtle">Most recently updated first.</p>
        </div>
        <div class="actions">
          <button class="primary" data-testid="new-collection" onClick={openCreate}>
            <IconPlus />
            New collection
          </button>
        </div>
      </div>

      {error && !creating && (
        <p class="notice error" data-testid="error" style="margin-bottom:16px">
          {error}
        </p>
      )}

      {creating && (
        <Dialog
          title="New collection"
          description="A collection groups related screenshots. The description tells other agents what it is for."
          onClose={() => setCreating(false)}
          testId="new-collection-dialog"
        >
          <form class="stack" onSubmit={create} data-testid="new-collection-form">
            {error && <p class="notice error">{error}</p>}
            <label class="field">
              <span class="field-label">Name</span>
              <input
                type="text"
                placeholder="Checkout redesign"
                data-testid="collection-name"
                value={name}
                autofocus
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span class="field-label">Description</span>
              <input
                type="text"
                placeholder="What is this collection for?"
                data-testid="collection-description"
                value={description}
                onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="dialog-actions">
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button class="primary" type="submit" data-testid="create-collection" disabled={!name.trim()}>
                Create collection
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {collections === null ? (
        <p class="subtle" style="margin-top:20px">
          Loading…
        </p>
      ) : collections.length === 0 ? (
        <div class="empty" style="margin-top:20px" data-testid="no-collections">
          <p style="margin:0 0 14px">No collections yet.</p>
          <button class="primary" onClick={openCreate}>
            <IconPlus />
            New collection
          </button>
        </div>
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
                      aria-label="Name"
                      data-testid="edit-name"
                      onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                    />
                    <input
                      type="text"
                      value={editDescription}
                      aria-label="Description"
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
                    <div class="subtle" style="margin-top:6px">
                      <span data-testid={`collection-count-${c.id}`}>{c.screenshot_count ?? 0}</span> screenshot
                      {(c.screenshot_count ?? 0) === 1 ? '' : 's'} · updated {formatTimestamp(c.updated_at)}
                    </div>
                  </>
                )}
              </div>

              <div class="row card-actions">
                <ShareButton
                  testId={`share-collection-${c.id}`}
                  subject={`“${c.name}” and its screenshots`}
                  onShare={(days) => api.shareCollection(c.id, days)}
                />
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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
