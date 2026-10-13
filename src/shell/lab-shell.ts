// DEV ONLY. boot.ts imports this behind `import.meta.env.DEV`, for the page src/pages/_lab.astro.
// The quality tier lives in the URL (`?q=`), because a tier is a property of the canvas: changing
// it means a new engine, and the simplest honest way to get one is to load the page again.
// The rest of the address says what to show (`?subject=sky&pose=first&ui=0`), so that a view can
// be linked to, and photographed by scripts/look/capture.mjs, which waits for `data-engine`.

import { createLab } from '../universe/api';
import { asTier } from './quality-memory';

export async function start(): Promise<void> {
  const mount = document.getElementById('lab-host');
  if (!mount) return;
  const query = new URLSearchParams(location.search);
  const root = document.documentElement;
  if (query.get('ui') === '0') root.dataset.labBare = '';
  await createLab({
    mount,
    quality: asTier(query.get('q')),
    query: new Map(query),
    onReady: () => {
      root.dataset.engine = 'ready';
    },
    onQuality: (tier) => {
      const url = new URL(location.href);
      url.searchParams.set('q', tier);
      location.assign(url);
    },
  });
}
