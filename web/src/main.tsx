import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { api } from './api';
import { navigate, useRoute } from './router';
import { CollectionsPage } from './pages/CollectionsPage';
import { CollectionPage } from './pages/CollectionPage';
import { ViewerPage } from './pages/ViewerPage';
import { SharesPage } from './pages/SharesPage';
import { PublicPage } from './pages/PublicPage';

function TopBar() {
  const [who, setWho] = useState<string | null>(null);
  useEffect(() => {
    api.me().then((r) => setWho(r.identity.actor)).catch(() => setWho(null));
  }, []);

  const go = (path: string) => (event: MouseEvent) => {
    event.preventDefault();
    navigate(path);
  };

  return (
    <header class="topbar">
      <a class="brand" href="/" onClick={go('/')}>
        kiekie
      </a>
      <a href="/" onClick={go('/')} data-testid="nav-collections">
        Collections
      </a>
      <a href="/shares" onClick={go('/shares')} data-testid="nav-shares">
        Share links
      </a>
      <div class="spacer" />
      <span class="who" data-testid="identity">
        {who ?? ''}
      </span>
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
      <TopBar />
      {route.name === 'collections' && <CollectionsPage />}
      {route.name === 'collection' && <CollectionPage cid={route.cid} />}
      {route.name === 'screenshot' && <ViewerPage cid={route.cid} sid={route.sid} />}
      {route.name === 'shares' && <SharesPage />}
      {route.name === 'notfound' && (
        <main>
          <h1>Not found</h1>
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
