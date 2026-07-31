import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { api } from './api';
import { navigate, useRoute } from './router';
import { useTheme } from './theme';
import { Logo } from './components/Logo';
import { IconMoon, IconSun } from './components/icons';
import { CollectionsPage } from './pages/CollectionsPage';
import { CollectionPage } from './pages/CollectionPage';
import { ViewerPage } from './pages/ViewerPage';
import { SharesPage } from './pages/SharesPage';
import { PublicPage } from './pages/PublicPage';

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      class="icon-btn"
      onClick={toggle}
      data-testid="theme-toggle"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function TopBar({ route }: { route: string }) {
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    api.me().then((r) => setWho(r.identity.actor)).catch(() => setWho(null));
  }, []);

  const go = (path: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(path);
  };

  // "Collections" stays lit for every screen underneath it, not just the index.
  const onCollections = route === 'collections' || route === 'collection' || route === 'screenshot';

  return (
    <header class="topbar">
      <a class="brand" href="/" onClick={go('/')} aria-label="kiekie home">
        <Logo />
      </a>
      <a
        class="navlink"
        href="/"
        onClick={go('/')}
        data-testid="nav-collections"
        aria-current={onCollections ? 'page' : undefined}
      >
        Collections
      </a>
      <a
        class="navlink"
        href="/shares"
        onClick={go('/shares')}
        data-testid="nav-shares"
        aria-current={route === 'shares' ? 'page' : undefined}
      >
        Share links
      </a>
      <div class="spacer" />
      <span class="who" data-testid="identity">
        {who ? (
          <>
            <span class="dot" />
            <span class="name">{who}</span>
          </>
        ) : (
          ''
        )}
      </span>
      <ThemeToggle />
    </header>
  );
}

function App() {
  const route = useRoute();

  if (route.name === 'public') {
    return <PublicPage token={route.token} sid={route.sid} />;
  }

  return (
    <>
      <TopBar route={route.name} />
      {route.name === 'collections' && <CollectionsPage />}
      {route.name === 'collection' && <CollectionPage cid={route.cid} />}
      {route.name === 'screenshot' && <ViewerPage cid={route.cid} sid={route.sid} />}
      {route.name === 'shares' && <SharesPage />}
      {route.name === 'notfound' && (
        <main>
          <div class="page-head">
            <div class="titles">
              <h1>Not found</h1>
              <p class="subtle">That page doesn't exist, or the link was mistyped.</p>
            </div>
          </div>
          <p>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
              Back to collections
            </a>
          </p>
        </main>
      )}
    </>
  );
}

render(<App />, document.getElementById('app')!);
