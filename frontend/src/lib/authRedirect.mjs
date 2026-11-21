const allowedParticipantPaths = new Set(['/', '/dashboard', '/register']);

export function getSafeReturnTo(value, fallback = '/') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return fallback;
  }

  let destination;
  try {
    destination = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  if (
    !destination.startsWith('/') ||
    destination.startsWith('//') ||
    destination.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(destination)
  ) {
    return fallback;
  }

  let url;
  try {
    url = new URL(destination, 'https://battle-miles.local');
  } catch {
    return fallback;
  }

  if (url.origin !== 'https://battle-miles.local' || !allowedParticipantPaths.has(url.pathname)) {
    return fallback;
  }

  return `${url.pathname}${url.search}`;
}
