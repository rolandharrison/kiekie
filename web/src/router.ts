import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'collections' }
  | { name: 'collection'; cid: string }
  | { name: 'screenshot'; cid: string; sid: string }
  | { name: 'shares' }
  | { name: 'public'; token: string; sid?: string }
  | { name: 'notfound' };

export function parse(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'collections' };
  if (parts[0] === 'shares' && parts.length === 1) return { name: 'shares' };
  if (parts[0] === 'c') {
    if (parts.length === 2) return { name: 'collection', cid: parts[1] };
    if (parts.length === 4 && parts[2] === 's') {
      return { name: 'screenshot', cid: parts[1], sid: parts[3] };
    }
  }
  if (parts[0] === 'p') {
    if (parts.length === 2) return { name: 'public', token: parts[1] };
    if (parts.length === 4 && parts[2] === 's') {
      return { name: 'public', token: parts[1], sid: parts[3] };
    }
  }
  return { name: 'notfound' };
}

export function navigate(path: string) {
  if (path === location.pathname) return;
  history.pushState({}, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parse(location.pathname));
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return route;
}
