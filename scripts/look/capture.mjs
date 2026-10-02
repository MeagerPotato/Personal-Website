// THE LOOK'S PICTURES. Takes the same views of the universe every time, so that a change to how
// it looks (docs/DESIGN.md, "Deep light") is judged on before-and-after pictures of one view and
// not on memory:
//
//   on the site   the first frame at home on each quality tier, the same under reduced motion,
//                 flying between systems, docked at home, at a planet, at a globe with a sea,
//                 at an emblem world and beside a sun, and the star map: on a desktop
//                 (1280 x 800) and on a narrow phone (360 x 780, touch, the bottom sheet)
//   in the lab    the sky alone from the seven views it is judged from (sim/skyDirections.ts),
//                 with no twinkle and no drift, so two runs give the same picture; and the
//                 stars: a sheet of each kind at 1:1, the heroes as a short and as a tall view
//                 draws them, and the sky's stars as the star map shows them; and the suns: a
//                 living sun of each family, one on the low tier and one as the star map shows
//                 it, and the Hardware sun, whose gears must stay readable in its halo
//   --perf        instead of pictures: what `?perf` reads on each tier, at home and docked
//
// It starts no server and never more than one browser. Start what it should look at, on ports
// of your own, and stop them when done (the machine is someone's computer):
//
//   npm run build
//   npx wrangler dev --port 4361 --ip 127.0.0.1 --local-protocol https --show-interactive-dev-session=false
//   npx astro dev --port 4362                       (the lab is dev server only)
//
//   node scripts/look/capture.mjs --out <dir> --site https://127.0.0.1:4361 --lab http://localhost:4362
//   node scripts/look/capture.mjs --out <dir> --site https://127.0.0.1:4361 --perf [--uncapped]
//
//   --only home,map    only the views whose name starts with one of these
//   --uncapped         (with --perf) let Chromium draw as fast as it can instead of at the
//                      display's rate, so that fps says what a frame costs and not what the
//                      display allows. Seconds of a busy GPU: keep it for when it matters.
//
// Chromium draws on the GPU here, as in playwright.config.ts: in software one page of the
// universe keeps seven cores busy. Not part of `verify`, and nothing in CI runs it.

import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, devices } from '@playwright/test';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    site: { type: 'string' },
    lab: { type: 'string' },
    only: { type: 'string' },
    perf: { type: 'boolean', default: false },
    uncapped: { type: 'boolean', default: false },
  },
});
if (!args.out || (!args.site && !args.lab)) {
  console.error('usage: capture.mjs --out <dir> [--site <origin>] [--lab <origin>] [--perf]');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });
const only = args.only ? args.only.split(',') : null;
const wanted = (name) => only === null || only.some((prefix) => name.startsWith(prefix));

// Whatever this starts runs below everything the person at the machine is doing.
try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
} catch {
  // Not allowed here: run at the usual priority.
}

const TIERS = ['low', 'medium', 'high'];
const POSES = ['first', 'cruise', 'docked', 'proj', 'hack', 'res', 'band'];
const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 } },
  // A Pixel 7's touch, coarse pointer (so half the stars and the dust) and pixel ratio, at the
  // narrowest width the site is checked at: 360 CSS px.
  phone: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
};
/** After the first frame: the planets are still being built, a slice a frame. */
const SETTLE_MS = 3000;

/** What a view does after its page is ready and before its picture. */
const still = async () => {};
const fly = async (page) => {
  // Straight out of the home system, with the boost: about 81 u/s, so 5 s is 400 u, between
  // home and its neighbours.
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForTimeout(5000);
};
const openMap = async (page) => {
  await page.keyboard.press('m');
  await page.locator('html[data-map="open"]').waitFor({ timeout: 15_000 });
  // The blend out to the map, and the names finding their places.
  await page.waitForTimeout(2500);
};

/** The views of the site: [name, path, tier, what to do first, reduced motion]. */
const SITE_VIEWS = [
  ...TIERS.map((tier) => [`home-${tier}`, '/', tier, still, false]),
  ['home-high-reduced', '/', 'high', still, true],
  ['flight-high', '/', 'high', fly, false],
  ['docked-home-high', '/about/', 'high', still, false],
  // Phones start on medium, and what a world wears differs by tier.
  ['docked-home-medium', '/about/', 'medium', still, false],
  // A generated globe with a sea (home is one too, but it wears a ring road and a town).
  ['docked-globe-high', '/projects/cyberpatriot/', 'high', still, false],
  ['docked-planet-high', '/projects/days2meet/', 'high', still, false],
  ['docked-emblem-high', '/projects/cal-hacks-13/', 'high', still, false],
  ['docked-planet-low', '/projects/days2meet/', 'low', still, false],
  ['sun-high', '/systems/software/', 'high', still, false],
  ['sun-low', '/systems/software/', 'low', still, false],
  // The other suns: each its own family and signs, and the Hardware sun, a ball of gears.
  ['sun-gear-high', '/systems/hardware/', 'high', still, false],
  ['sun-research-high', '/systems/research/', 'high', still, false],
  ['sun-hackathons-medium', '/systems/hackathons/', 'medium', still, false],
  ['sun-high-reduced', '/systems/software/', 'high', still, true],
  ['map-high', '/', 'high', openMap, false],
  ['map-low', '/', 'low', openMap, false],
  ['map-high-reduced', '/', 'high', openMap, true],
];

/**
 * The lab's views, [name, what the lab is asked for, tier]: the sky from each pose on high, and
 * from the first on the other tiers; then the stars.
 */
const STAR_KINDS = ['dust', 'field', 'bright', 'mid', 'hero'];
const LAB_VIEWS = [
  ...POSES.map((pose) => [`sky-${pose}-high`, `subject=sky&pose=${pose}`, 'high']),
  ['sky-first-medium', 'subject=sky&pose=first', 'medium'],
  ['sky-first-low', 'subject=sky&pose=first', 'low'],
  ...STAR_KINDS.map((kind) => [
    `stars-${kind}-high`,
    `subject=stars&pose=band&starKind=${kind}`,
    'high',
  ]),
  ['stars-hero-600-high', 'subject=stars&pose=band&starKind=hero&starRows=600', 'high'],
  ['stars-hero-1080-high', 'subject=stars&pose=band&starKind=hero&starRows=1080', 'high'],
  ['stars-hero-low', 'subject=stars&pose=band&starKind=hero', 'low'],
  ['stars-map-high', 'subject=stars&pose=band&starMap=1', 'high'],
  ...['sky', 'mint', 'lilac', 'coral', 'butter'].map((family) => [
    `lab-sun-${family}-high`,
    `subject=sun&theme=${family}&radius=20&turn=0`,
    'high',
  ]),
  ['lab-sun-sky-low', 'subject=sun&theme=sky&radius=20&turn=0', 'low'],
  ['lab-sun-sky-map-high', 'subject=sun&theme=sky&radius=20&turn=0&onMap=1', 'high'],
  // Straight to the canvas, with no bloom on top: the disc is exactly its token.
  ['lab-sun-sky-map-low', 'subject=sun&theme=sky&radius=20&turn=0&onMap=1', 'low'],
  ['lab-sun-gear-high', 'subject=world&world=system/hardware&turn=0', 'high'],
  ['lab-sun-software-high', 'subject=world&world=system/software&turn=0', 'high'],
];

const browser = await chromium.launch({
  args: [
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    ...(args.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []),
  ],
});

async function open(size, reducedMotion, url) {
  const context = await browser.newContext({
    ...SIZES[size],
    ignoreHTTPSErrors: true,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  // A visitor who has seen the "how to fly" card: it sits over a corner of the sky.
  await context.addInitScript(() => {
    try {
      globalThis.localStorage.setItem('hints', 'seen');
    } catch {
      // No storage on this page.
    }
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' || /shader|WebGL|GLSL/i.test(message.text()))
      problems.push(message.text());
  });
  await page.goto(url);
  await page.locator('html[data-engine="ready"]').waitFor({ timeout: 60_000 });
  return { context, page, problems };
}

const report = [];
const failed = [];

async function shoot(name, size, reducedMotion, url, before) {
  const file = `${name}-${size}.png`;
  const started = Date.now();
  let context;
  try {
    const opened = await open(size, reducedMotion, url);
    context = opened.context;
    const { page, problems } = opened;
    await page.waitForTimeout(SETTLE_MS);
    await before(page);
    await page.screenshot({ path: join(args.out, file) });
    const state = await page.evaluate(() => ({ ...globalThis.document.documentElement.dataset }));
    report.push({ file, url, state, problems });
    console.log(
      `${file}  ${((Date.now() - started) / 1000).toFixed(1)} s` +
        (problems.length ? `  PROBLEMS: ${problems.join(' | ')}` : ''),
    );
    if (problems.length) failed.push(file);
  } catch (error) {
    failed.push(file);
    console.log(`${file}  FAILED: ${String(error).split('\n')[0]}`);
  } finally {
    await context?.close();
  }
}

async function perf(name, url) {
  const { context, page, problems } = await open('desktop', false, url);
  try {
    await page.waitForTimeout(SETTLE_MS + 2000);
    const samples = [];
    for (let i = 0; i < 4; i += 1) {
      await page.waitForTimeout(1000);
      samples.push(await page.locator('#universe-host pre[aria-hidden="true"]').innerText());
    }
    // fps, average and worst frame time: the read-out's first two lines.
    const read = samples.map((text) => ({
      fps: Number(/fps\s+(\d+)/.exec(text)?.[1]),
      ms: Number(/ms\s+([\d.]+)/.exec(text)?.[1]),
      worst: Number(/worst\s+(\d+)/.exec(text)?.[1]),
    }));
    const mean = (key) => read.reduce((sum, sample) => sum + sample[key], 0) / read.length;
    const line = {
      view: name,
      fps: Number(mean('fps').toFixed(0)),
      ms: Number(mean('ms').toFixed(2)),
      worstMs: Math.max(...read.map((sample) => sample.worst)),
      draws: /draws\s+(\d+)/.exec(samples.at(-1))?.[1],
      tris: /tris\s+(\d+)/.exec(samples.at(-1))?.[1],
      px: /px\s+(.+)/.exec(samples.at(-1))?.[1],
      problems,
    };
    report.push(line);
    console.log(JSON.stringify(line));
  } finally {
    await context.close();
  }
}

try {
  if (args.perf) {
    for (const tier of TIERS) {
      for (const [view, path] of [
        ['home', '/'],
        ['docked', '/about/'],
        ['sun', '/systems/software/'],
      ]) {
        if (wanted(view))
          await perf(`${view}-${tier}`, `${args.site}${path}?universe&perf&q=${tier}`);
      }
    }
    writeFileSync(
      join(args.out, args.uncapped ? 'perf-uncapped.json' : 'perf.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } else {
    if (args.site) {
      for (const size of Object.keys(SIZES)) {
        for (const [name, path, tier, before, reduced] of SITE_VIEWS) {
          if (!wanted(name)) continue;
          await shoot(name, size, reduced, `${args.site}${path}?universe&q=${tier}`, before);
        }
      }
    }
    if (args.lab) {
      for (const [name, what, tier] of LAB_VIEWS) {
        if (!wanted(name)) continue;
        const url = `${args.lab}/lab/?${what}&q=${tier}&ui=0&still=1`;
        await shoot(name, 'desktop', false, url, still);
        if (name === 'sky-first-high' || name === 'stars-hero-high' || name === 'lab-sun-sky-high')
          await shoot(name, 'phone', false, url, still);
      }
    }
    writeFileSync(join(args.out, 'capture.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
} finally {
  await browser.close();
}
if (failed.length) {
  console.error(`${failed.length} view(s) with problems: ${failed.join(', ')}`);
  process.exitCode = 1;
}
