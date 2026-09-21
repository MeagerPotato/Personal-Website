// Test fixtures shared by swap.test.ts and router.test.ts: pages with the same shape as the built
// site (what scripts/verify-dist.mjs calls the swap contract), small enough to read in a test.

export interface TestPage {
  title: string;
  main: string;
  /** Which nav link carries aria-current, as the layout would have rendered it. */
  current?: '/about/' | '/projects/';
  currentValue?: 'page' | 'true';
  /** Extra per-page head nodes (they must carry data-page-head). */
  extraHead?: string;
  build?: string;
  plainOnly?: boolean;
  /** An extra SHARED head node: a page like this breaks the contract. */
  rogueHead?: string;
}

const navLink = (href: string, label: string, page: TestPage): string => {
  const current = page.current === href ? ` aria-current="${page.currentValue ?? 'page'}"` : '';
  return `<li><a href="${href}"${current}>${label}</a></li>`;
};

export const headHtml = (page: TestPage): string =>
  [
    '<meta charset="utf-8">',
    `<title data-page-head>${page.title}</title>`,
    `<meta name="description" content="About ${page.title}" data-page-head>`,
    `<link rel="canonical" href="https://allenkh.com/${page.title}/" data-page-head>`,
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${page.title}" data-page-head>`,
    page.extraHead ?? '',
    `<meta name="build" content="${page.build ?? 'abc123'}">`,
    page.rogueHead ?? '',
    '<link rel="stylesheet" href="/_astro/site.css">',
  ]
    .filter((node) => node !== '')
    // The real build leaves a space between most head nodes. Those are text nodes, and a swap
    // has to put them back where a fresh load would have them.
    .join(' ');

export const bodyHtml = (page: TestPage): string =>
  [
    '<a class="skip-link" href="#main">Skip to content</a>',
    '<div id="universe-host"><canvas></canvas></div>',
    '<header class="masthead"><a class="wordmark" href="/">Allen</a>',
    '<nav class="site-nav"><ul>',
    navLink('/about/', 'About', page),
    navLink('/projects/', 'Projects', page),
    '</ul></nav>',
    '<button type="button" data-panel-toggle aria-expanded="false">About this site</button>',
    '</header>',
    '<div class="panel"><div class="panel-bar">',
    '<button type="button" data-panel-resize aria-pressed="false">Expand</button>',
    '<button type="button" data-panel-close>Close</button></div>',
    `<main id="main" tabindex="-1" data-flight-keys="off">${page.main}</main></div>`,
    '<footer><a href="?plain" data-router-ignore>Plain version</a></footer>',
  ].join('');

export const pageHtml = (page: TestPage): string =>
  `<!doctype html><html lang="en"${page.plainOnly ? ' data-plain-only' : ''}>` +
  `<head>${headHtml(page)}</head><body>${bodyHtml(page)}</body></html>`;

/** Make `page` the document that is showing. */
export function showPage(page: TestPage): void {
  document.documentElement.toggleAttribute('data-plain-only', page.plainOnly === true);
  document.head.innerHTML = headHtml(page);
  document.body.innerHTML = bodyHtml(page);
}

export const parsePage = (page: TestPage): Document =>
  new DOMParser().parseFromString(pageHtml(page), 'text/html');

export const HOME: TestPage = {
  title: 'home',
  main: '<h1 tabindex="-1">Home</h1><a id="to-about" href="/about/">About me</a>',
};
export const ABOUT: TestPage = {
  title: 'about',
  current: '/about/',
  main: '<h1 tabindex="-1">About</h1><p id="story">Rockets.</p>',
};
export const FISHAI: TestPage = {
  title: 'fishai',
  current: '/projects/',
  currentValue: 'true',
  main: '<h1 tabindex="-1">FishAI</h1><h2 id="the-bots">The bots</h2>',
  extraHead:
    '<meta property="og:image" content="https://allenkh.com/x.jpg" data-page-head>' +
    '<script type="application/ld+json" data-page-head>{"@type":"SoftwareSourceCode"}</script>',
};
