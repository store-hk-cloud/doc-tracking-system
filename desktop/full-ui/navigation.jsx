import { useSyncExternalStore } from 'react';
import { matchRoute } from './routes.mjs';
import routes from 'desktop:routes';

const subscribe = (callback) => {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
};
const getPath = () => window.location.pathname;
const routePaths = Object.keys(routes);

function navigate(href, replace = false) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

const router = { push: navigate, replace: (href) => navigate(href, true) };
export function useRouter() {
  return router;
}

export function usePathname() {
  return useSyncExternalStore(subscribe, getPath);
}

export function useRoute() {
  const path = usePathname();
  return matchRoute(routePaths, path);
}

export function useParams() {
  return useRoute()?.params ?? {};
}
