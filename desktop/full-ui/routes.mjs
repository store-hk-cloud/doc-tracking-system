export function matchRoute(routes, pathname) {
  let segments;
  try {
    segments = pathname.replace(/\/$/, '').split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  let best = null;
  let bestScore = -1;
  for (const route of routes) {
    const pattern = route.replace(/\/$/, '').split('/');
    if (pattern.length !== segments.length) continue;
    const params = {};
    let score = 0;
    const matches = pattern.every((part, index) => {
      const param = /^\[(\w+)\]$/.exec(part);
      if (param && segments[index]) {
        params[param[1]] = segments[index];
        return true;
      }
      if (part !== segments[index]) return false;
      score++;
      return true;
    });
    if (matches && score > bestScore) {
      best = { route, params };
      bestScore = score;
    }
  }
  return best;
}
