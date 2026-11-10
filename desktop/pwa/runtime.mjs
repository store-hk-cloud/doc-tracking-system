export function pwaHref(href, basePath) {
  return href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/') ? basePath + '#' + href : href;
}
export function pwaPath(hash) {
  return hash.startsWith('#/') ? hash.slice(1).split('?')[0] : '/';
}
export function browserStorage(storage) {
  return {
    getItem: async (key) => storage.getItem(key),
    setItem: async (key, value) => storage.setItem(key, value),
    removeItem: async (key) => storage.removeItem(key),
  };
}
export function followFragment(href, document) {
  if (!href?.startsWith('#') || href.startsWith('#/')) return false;
  const target = document.getElementById(href.slice(1));
  if (!target) return false;
  target.focus();
  target.scrollIntoView();
  return true;
}
