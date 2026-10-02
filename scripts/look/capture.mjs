// THE LOOK'S PICTURES. Takes the same views of the universe every time, so that a change to how
// it looks (docs/DESIGN.md, "Deep light") is judged on before-and-after pictures of one view and
// not on memory:
//
//   on the site   the first frame at home on each quality tier, the same under reduced motion,
//                 flying between systems, docked at home, at a planet, at a globe with a sea,
//                 at an emblem world and beside a sun, at each world with air (and home's on
//                 every tier: what a world wears differs by tier), at the bodies with lamps,
//                 and the star map, whole and zoomed in on a system (its chart: the dot grid,
//                 the districts and their dashed rings, and the traffic on the orbits): on a
//                 desktop (1280 x 800) and on a narrow phone (360 x 780, touch, the bottom
//                 sheet; `--phone 412x839` for another size)
//   in the lab    the sky alone from the seven views it is judged from (sim/skyDirections.ts),
//                 with no twinkle and no drift, so two runs give the same picture; and the
//                 stars: a sheet of each kind at 1:1, the heroes as a short and as a tall view
//                 draws them, and the sky's stars as the star map shows them; and the suns: a
//                 living sun of each family, one on the low tier and one as the star map shows
//                 it, and the Hardware sun, whose gears must stay readable in its halo; and
//                 the worlds with air: each by day, home at dusk, by night (its lamps) and as
//                 the star map shows it, on each tier, and the bodies with lamps; and orbit
//                 lines with their traffic over the gas, at the tuning's strength and at a
//                 stronger one, and the chart from above
//   --perf        instead of pictures: what `?perf` reads on each tier, at home, docked, beside
//                 a sun and on the star map
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
    phone: { type: 'string' },
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
if (args.phone) {
  const [width, height] = args.phone.split('x').map(Number);
  if (!(width > 0) || !(height > 0)) {
    console.error('--phone takes a size, as 412x839');
    process.exit(2);
  }
  SIZES.phone.viewport = { width, height };
}
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

const zoomMap = async (page) => {
  await openMap(page);
  // In on the Projects binary, the largest district: the pointer on it, the wheel toward it.
  const { width, height } = page.viewportSize();
  const at = await page.evaluate(() => {
    const name = [...globalThis.document.querySelectorAll('#universe-overlay *')].find(
      (node) => node.childElementCount === 0 && /software/i.test(node.textContent ?? ''),
    );
    const box = name?.getBoundingClientRect();
    return box ? [box.left + box.width / 2, box.top - 12] : null;
  });
  await page.mouse.move(...(at ?? [width / 2, height / 2]));
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -160);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(2000);
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
  // The worlds with air: home on the tier with no clouds, and the other three.
  ['docked-home-low', '/about/', 'low', still, false],
  ['docked-home-high-reduced', '/about/', 'high', still, true],
  ['docked-tide-high', '/projects/hackgt-13/', 'high', still, false],
  ['docked-rover-high', '/projects/robotics/', 'high', still, false],
  ['docked-emblem-medium', '/projects/cal-hacks-13/', 'medium', still, false],
  // The bodies with lamps: the bus's lit panes, the station's pods.
  ['docked-bus-high', '/projects/hackathons-at-berkeley/', 'high', still, false],
  ['docked-station-high', '/resume/', 'high', still, false],
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
  ['map-medium', '/', 'medium', openMap, false],
  // The chart up close: a district's two steps and its dashed ring, and the traffic.
  ['map-zoom-high', '/', 'high', zoomMap, false],
  ['map-zoom-low', '/', 'low', zoomMap, false],
];

/**
 * The lab's views, [name, what the lab is asked for, tier]: the sky from each pose on high, and
 * from the first on the other tiers; then the stars.
 */
const STAR_KINDS = ['dust', 'field', 'bright', 'mid', 'hero'];
/** The worlds with air (design/tuning.ts, `look.air.worlds`). */
const AIR_WORLDS = [
  'page/about',
  'project/cyberpatriot',
  'project/robotics',
  'project/hackgt-13',
  'project/cal-hacks-13',
];
/** The lab's light, low and from the side (the terminator down the middle), and from behind. */
const DUSK = 'lightAzimuthDeg=80&lightElevationDeg=8';
const NIGHT = 'lightAzimuthDeg=150&lightElevationDeg=10';
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
  // The worlds with air, each by day; home at dusk, by night up close (its lamps), on the
  // other tiers, and as the star map shows it: flat, with no air.
  ...AIR_WORLDS.map((id) => [
    `lab-air-${id.split('/')[1]}-high`,
    `subject=world&world=${id}&turn=0`,
    'high',
  ]),
  ['lab-air-about-dusk-high', `subject=world&world=page/about&turn=0&${DUSK}`, 'high'],
  ['lab-air-about-night-high', `subject=world&world=page/about&turn=0&near=1&${NIGHT}`, 'high'],
  ['lab-air-about-medium', 'subject=world&world=page/about&turn=0', 'medium'],
  ['lab-air-about-low', 'subject=world&world=page/about&turn=0', 'low'],
  ['lab-air-about-night-low', `subject=world&world=page/about&turn=0&near=1&${NIGHT}`, 'low'],
  ['lab-air-about-map-high', 'subject=world&world=page/about&turn=0&onMap=1', 'high'],
  [
    'lab-air-cal-hacks-13-night-high',
    `subject=world&world=project/cal-hacks-13&turn=0&${NIGHT}`,
    'high',
  ],
  // A generated planet in each air the tokens have (its biome's).
  ...['tide', 'dune', 'frost', 'ember', 'bloom'].map((biome) => [
    `lab-air-planet-${biome}-high`,
    `subject=planet&biome=${biome}&turn=0`,
    'high',
  ]),
  ['lab-lamps-bus-high', 'subject=world&world=project/hackathons-at-berkeley&turn=0', 'high'],
  ['lab-lamps-station-high', 'subject=world&world=page/resume&turn=0&near=1', 'high'],
  ['lab-lamps-satellite-high', 'subject=world&world=page/contact&turn=0&near=1', 'high'],
  // Orbit lines and their traffic in front of the Projects pool (the `first` view), in the
  // pool's own family and in another: at the tuning's strength, and at the stronger one the
  // look's verdict asked to have judged (0.26, and 0.13 for a binary's sun's path).
  ...['sky', 'coral', 'butter'].flatMap((family) => [
    [`lab-orbits-${family}-high`, `subject=orbits&pose=first&moving=0&theme=${family}`, 'high'],
    [
      `lab-orbits-${family}-strong-high`,
      `subject=orbits&pose=first&moving=0&theme=${family}&lineOpacity=0.26&trackOpacity=0.13`,
      'high',
    ],
  ]),
  ['lab-orbits-sky-low', 'subject=orbits&pose=first&moving=0&theme=sky', 'low'],
  // The star map's ground from above, whole and close.
  ['lab-chart-high', 'subject=chart', 'high'],
  ['lab-chart-low', 'subject=chart', 'low'],
  ['lab-chart-near-high', 'subject=chart&chartSpanU=500', 'high'],
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
  // The baked sky arrives after the first frame (world/SkyBake.ts): a picture, or a frame time,
  // taken before it is there would be of the sky it replaces, or of the bake itself.
  await page.locator('html[data-sky="ready"], html[data-sky="off"]').waitFor({ timeout: 60_000 });
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

async function perf(name, url, before = still) {
  const { context, page, problems } = await open('desktop', false, url);
  try {
    await page.waitForTimeout(SETTLE_MS);
    await before(page);
    await page.waitForTimeout(2000);
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
      for (const [view, path, before] of [
        ['home', '/', still],
        ['docked', '/about/', still],
        ['sun', '/systems/software/', still],
        ['map', '/', openMap],
      ]) {
        if (wanted(view))
          await perf(`${view}-${tier}`, `${args.site}${path}?universe&perf&q=${tier}`, before);
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
