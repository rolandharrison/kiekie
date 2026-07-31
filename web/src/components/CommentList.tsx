import { useState } from 'preact/hooks';
import type { Annotation } from '../api';
import { formatTimestamp } from '../buckets';

interface Props {
  annotations: Annotation[];
  readOnly?: boolean;
  activeId?: string | null;
  onSelect?: (id: string | null) => void;
  onEdit?: (id: string, body: string) => Promise<void>;
  onResolve?: (id: string, resolved: boolean) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

function describe(a: Annotation): string {
  if (a.x === null) return 'whole image';
  if ((a.w ?? 0) === 0 && (a.h ?? 0) === 0) return 'pin';
  return 'region';
}

export function CommentList({
  annotations,
  readOnly = false,
  activeId,
  onSelect,
  onEdit,
  onResolve,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (annotations.length === 0) {
    return (
      <p class="subtle" data-testid="no-comments">
        No comments yet.
      </p>
    );
  }

  return (
    <div class="stack" data-testid="comment-list">
      {annotations.map((a) => (
        <div
          key={a.id}
          class={`comment${a.resolved ? ' resolved' : ''}`}
          data-testid={`comment-${a.id}`}
          data-resolved={a.resolved ? 'true' : 'false'}
          onClick={() => onSelect?.(activeId === a.id ? null : a.id)}
        >
          <div class="who">
            <strong>{a.author ?? 'unknown'}</strong>
            <span>·</span>
            <span>{formatTimestamp(a.created_at)}</span>
            <span>·</span>
            <span data-testid={`comment-kind-${a.id}`}>{describe(a)}</span>
            {a.resolved && <span data-testid={`comment-resolved-${a.id}`}>· resolved</span>}
          </div>

          {editing === a.id ? (
            <div class="stack" onClick={(e) => e.stopPropagation()}>
              <textarea
                value={draft}
                data-testid="comment-edit-input"
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              />
              <div class="row">
                <button
                  class="primary small"
                  data-testid="comment-edit-save"
                  onClick={async () => {
                    await onEdit?.(a.id, draft);
                    setEditing(null);
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
            <div class="body">{a.body}</div>
          )}

          {!readOnly && editing !== a.id && (
            <div class="actions" onClick={(e) => e.stopPropagation()}>
              <button
                class="small"
                data-testid={`comment-resolve-${a.id}`}
                onClick={() => onResolve?.(a.id, !a.resolved)}
              >
                {a.resolved ? 'Unresolve' : 'Resolve'}
              </button>
              <button
                class="small"
                data-testid={`comment-edit-${a.id}`}
                onClick={() => {
                  setEditing(a.id);
                  setDraft(a.body);
                }}
              >
                Edit
              </button>
              <button
                class="small danger"
                data-testid={`comment-delete-${a.id}`}
                onClick={() => onDelete?.(a.id)}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
