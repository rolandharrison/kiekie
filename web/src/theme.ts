import { useEffect, useState } from 'preact/hooks';

export type Theme = 'light' | 'dark';

const KEY = 'kiekie-theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** What the page is currently showing: the pinned choice, else the OS setting. */
function currentTheme(): Theme {
  const pinned = document.documentElement.dataset.theme;
  return pinned === 'light' || pinned === 'dark' ? pinned : systemTheme();
}

/**
 * Theme is pinned by writing `data-theme` on <html> — the same attribute the
 * inline script in index.html sets before first paint, so toggling and reloading
 * agree and there is no flash.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  // Follow the OS while the user hasn't pinned anything.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!mq) return;
    const onChange = () => {
      if (!document.documentElement.dataset.theme) setTheme(systemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode can refuse storage; the toggle still works for this page.
    }
    setTheme(next);
  };

  return [theme, toggle];
}
