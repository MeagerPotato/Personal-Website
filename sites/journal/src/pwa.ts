/**
 * Installs the service worker (sw/sw.js) in production builds only: in development it would
 * cache files that are meant to change on every save.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // No service worker (a private window, say): the app still works online.
    });
  });
}
