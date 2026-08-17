import { useCallback, useEffect, useState } from 'react';

/**
 * Minimal History-API router — deliberately NOT react-router.
 *
 * This application has three views and one path parameter (/schedule/:week).
 * react-router would add a dependency and a provider tree to solve a problem
 * that is ~40 lines here, and it would not make anything else simpler. If the
 * app later grows nested layouts, guards, or many routes, swapping this out is
 * a contained change.
 *
 * Real paths (not hashes) work because the Express server already serves
 * index.html for any non-API path, so refreshing /schedule/BU loads the app.
 */

export const VIEWS = {
  DASHBOARD: 'dashboard',
  SCHEDULE: 'schedule',
  UPLOAD: 'upload',
  RUNS: 'runs',
  NOT_FOUND: 'notfound'
};

export function parseRoute(pathname) {
  const segments = String(pathname || '/')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  if (segments.length === 0) return { view: VIEWS.DASHBOARD, week: null };

  const [head, second] = segments;
  if (head === 'dashboard') return { view: VIEWS.DASHBOARD, week: null };
  if (head === 'upload') return { view: VIEWS.UPLOAD, week: null };
  // NOTE: the client route is /history, not /runs, because GET /runs is a real API
  // endpoint served by Express — a browser navigation to /runs would return JSON.
  if (head === 'history') return { view: VIEWS.RUNS, week: null };
  if (head === 'schedule') {
    return { view: VIEWS.SCHEDULE, week: second ? decodeURIComponent(second).toUpperCase() : null };
  }
  return { view: VIEWS.NOT_FOUND, week: null };
}

export function useRoute() {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname
  );

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (to === window.location.pathname) return;
    if (replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setPathname(to);
    // Views are full-page swaps; start each at the top like a normal navigation.
    window.scrollTo({ top: 0 });
  }, []);

  return { ...parseRoute(pathname), pathname, navigate };
}
