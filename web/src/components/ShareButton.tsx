import { useState } from 'preact/hooks';

interface Props {
  onShare: () => Promise<{ url: string }>;
  testId?: string;
  label?: string;
}

/** Mints (or re-fetches) a share link and shows it for copying. */
export function ShareButton({ onShare, testId = 'share-button', label = 'Share' }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function share() {
    setBusy(true);
    try {
      setUrl((await onShare()).url);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; the link is on screen either way.
    }
  }

  if (!url) {
    return (
      <button class="small" data-testid={testId} disabled={busy} onClick={share}>
        {busy ? 'Sharing…' : label}
      </button>
    );
  }

  return (
    <div class="share-row" data-testid={`${testId}-result`}>
      <code data-testid={`${testId}-url`}>{url}</code>
      <a class="btn small" href={url} target="_blank" rel="noreferrer" data-testid={`${testId}-open`}>
        Open
      </a>
      <button class="small" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
