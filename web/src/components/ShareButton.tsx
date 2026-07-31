import { useState } from 'preact/hooks';
import type { MintedShare } from '../api';
import { formatTimestamp } from '../buckets';

interface Props {
  onShare: (expiresInDays: number | null) => Promise<MintedShare>;
  testId?: string;
  label?: string;
}

const EXPIRY_CHOICES: { label: string; days: number | null }[] = [
  { label: 'Never expires', days: null },
  { label: 'Expires in 1 day', days: 1 },
  { label: 'Expires in 7 days', days: 7 },
  { label: 'Expires in 30 days', days: 30 },
];

/** Mints (or re-fetches) a share link and shows it for copying. */
export function ShareButton({ onShare, testId = 'share-button', label = 'Share' }: Props) {
  const [minted, setMinted] = useState<MintedShare | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    setBusy(true);
    try {
      setMinted(await onShare(days));
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

  if (!minted) {
    return (
      <div class="row">
        <select
          data-testid={`${testId}-expiry`}
          value={days === null ? '' : String(days)}
          style="width:auto"
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
        <button class="small" data-testid={testId} disabled={busy} onClick={share}>
          {busy ? 'Sharing…' : label}
        </button>
      </div>
    );
  }

  return (
    <div class="stack" style="gap:4px" data-testid={`${testId}-result`}>
      <div class="share-row">
        <code data-testid={`${testId}-url`}>{minted.url}</code>
        <a
          class="btn small"
          href={minted.url}
          target="_blank"
          rel="noreferrer"
          data-testid={`${testId}-open`}
        >
          Open
        </a>
        <button class="small" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div class="subtle" data-testid={`${testId}-expiry-note`}>
        {minted.expires_at ? `Expires ${formatTimestamp(minted.expires_at)}` : 'Never expires'}
      </div>
    </div>
  );
}
