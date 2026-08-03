import { useState } from 'preact/hooks';
import type { MintedShare } from '../api';
import { formatTimestamp } from '../buckets';
import { Dialog } from './Dialog';
import { IconLink, IconShare } from './icons';

interface Props {
  onShare: (expiresInDays: number | null) => Promise<MintedShare>;
  testId?: string;
  label?: string;
  /** What is being shared, for the dialog's wording. */
  subject?: string;
}

const EXPIRY_CHOICES: { label: string; days: number | null }[] = [
  { label: 'Never expires', days: null },
  { label: 'Expires in 1 day', days: 1 },
  { label: 'Expires in 7 days', days: 7 },
  { label: 'Expires in 30 days', days: 30 },
];

/**
 * Opens a dialog that mints (or re-fetches) a share link.
 *
 * The expiry choice lives in the dialog rather than inline next to the button:
 * it is a decision you make once, at the moment of sharing, and leaving a
 * select permanently on screen made every collection row look like a form.
 */
export function ShareButton({
  onShare,
  testId = 'share-button',
  label = 'Share',
  subject = 'this',
}: Props) {
  const [open, setOpen] = useState(false);
  const [minted, setMinted] = useState<MintedShare | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    // Start clean next time, so a stale link is never mistaken for a fresh one.
    setMinted(null);
    setError(null);
    setCopied(false);
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setMinted(await onShare(days));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the link is on screen either way.
    }
  }

  return (
    <>
      <button class="small" data-testid={testId} onClick={() => setOpen(true)}>
        <IconShare />
        {label}
      </button>

      {open && (
        <Dialog
          title="Share a read-only link"
          description={`Anyone with the link can view ${subject} — no login needed.`}
          onClose={close}
          testId={`${testId}-dialog`}
        >
          <div class="stack">
            {error && <p class="notice error">{error}</p>}

            {!minted ? (
              <>
                <label class="field">
                  <span class="field-label">Expiry</span>
                  <select
                    data-testid={`${testId}-expiry`}
                    value={days === null ? '' : String(days)}
                    onChange={(e) => {
                      const raw = (e.target as HTMLSelectElement).value;
                      setDays(raw === '' ? null : Number(raw));
                    }}
                  >
                    {EXPIRY_CHOICES.map((choice) => (
                      <option key={choice.label} value={choice.days === null ? '' : String(choice.days)}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div class="dialog-actions">
                  <button type="button" onClick={close}>
                    Cancel
                  </button>
                  <button
                    class="primary"
                    data-testid={`${testId}-create`}
                    disabled={busy}
                    onClick={create}
                  >
                    <IconLink />
                    {busy ? 'Creating…' : 'Create link'}
                  </button>
                </div>
              </>
            ) : (
              <div class="stack" style="gap:8px" data-testid={`${testId}-result`}>
                <div class="share-row">
                  <IconLink />
                  <code data-testid={`${testId}-url`}>{minted.url}</code>
                </div>
                <div class="subtle" data-testid={`${testId}-expiry-note`}>
                  {minted.expires_at ? `Expires ${formatTimestamp(minted.expires_at)}` : 'Never expires'}
                </div>
                <div class="dialog-actions">
                  <a
                    class="btn"
                    href={minted.url}
                    target="_blank"
                    rel="noreferrer"
                    data-testid={`${testId}-open`}
                  >
                    Open
                  </a>
                  <button class="primary" onClick={copy}>
                    {copied ? 'Copied' : 'Copy link'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
