// DEV ONLY. boot.ts imports this behind `import.meta.env.DEV`, for the page src/pages/_lab.astro.
// The quality tier lives in the URL (`?q=`), because a tier is a property of the canvas: changing
// it means a new engine, and the simplest honest way to get one is to load the page again.

import { createLab } from '../universe/api';
import { asTier } from './quality-memory';

export async function start(): Promise<void> {
  const mount = document.getElementById('lab-host');
  if (!mount) return;
  await createLab({
    mount,
    quality: asTier(new URLSearchParams(location.search).get('q')),
    onQuality: (tier) => {
      const url = new URL(location.href);
      url.searchParams.set('q', tier);
      location.assign(url);
    },
  });
}
