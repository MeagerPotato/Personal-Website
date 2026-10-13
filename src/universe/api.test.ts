// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUniverse, type Deck, type DeckCard, type Universe } from './api';
import { buildUniverse } from './data/build';
import type { BootHooks, Booted } from './main';

/**
 * What the web layer last SAID (the panel's inset, the page's deck of cards, the map) is not the
 * engine's state, so no snapshot carries it: api.ts keeps it and tells an engine built again.
 * Here the engine itself is stood in for (`boot` needs a WebGL context; the browser tests have
 * one: tests/e2e/rebuild.spec.ts), and each stand-in writes down what it was told.
 */
const engines = vi.hoisted(
  () => [] as { hooks: BootHooks; told: unknown[][]; disposed: boolean }[],
);

vi.mock('./main', () => ({
  boot: (_options: unknown, hooks: BootHooks): Booted => {
    const told: unknown[][] = [];
    const engine = { hooks, told, disposed: false };
    engines.push(engine);
    return {
      engine: {
        setPaused: () => undefined,
        dispose: () => {
          engine.disposed = true;
        },
      },
      navigator: { frameUpdate: () => undefined },
      setInset: (inset: unknown, cut: boolean) => told.push(['inset', inset, cut]),
      setDeck: (deck: unknown, cut: boolean) => told.push(['deck', deck, cut]),
      setMapOpen: (open: boolean, cut: boolean) => told.push(['map', open, cut]),
      snapshot: () => ({
        steps: 600,
        ship: { x: 0, z: 0, vx: 0, vz: 0, heading: 0, yawRate: 0 },
        dock: null,
        halting: false,
        guarding: false,
        galaxy: 'here',
      }),
    } as unknown as Booted;
  },
}));

/** A small galaxy as the build makes it (the fixture of manifest.test.ts, less its moon). */
const manifest = buildUniverse(
  {
    systems: [
      {
        id: 'code',
        name: 'Code',
        href: '/systems/code/',
        theme: 'sky',
        order: 1,
        position: 'auto',
      },
    ],
    projects: [
      {
        id: 'fishai',
        title: 'FishAI',
        href: '/projects/fishai/',
        system: 'code',
        date: '2025-06',
        size: 'l',
        biome: 'terra',
        rings: false,
        decorMoons: 0,
        flagship: false,
        related: [],
        draft: false,
      },
    ],
    pages: [{ id: 'about', title: 'About', href: '/about/', dock: 'home' }],
    includeDrafts: false,
  },
  {},
);

const DECK: Deck = {
  body: 'page/about',
  cards: [
    { key: 'rockets', x: 412, y: 236, side: -1 },
    { key: 'community', x: 868, y: 236, side: 1 },
  ],
  open: 'rockets',
};

let universe: Universe | null = null;
afterEach(() => {
  universe?.dispose();
  universe = null;
  engines.length = 0;
});

const start = async (reducedMotion = false): Promise<Universe> => {
  universe = await createUniverse({
    mount: document.createElement('div'),
    manifest,
    reducedMotion,
  });
  return universe;
};
/** The engine that is running: the last one built. */
const running = () => {
  const engine = engines.at(-1);
  if (!engine) throw new Error('no engine was built');
  return engine;
};
/** The browser takes the WebGL context: the engine is thrown away and built again. */
const rebuild = (): void => running().hooks.onContextLost();

describe('what the web layer said, across a rebuild', () => {
  it('tells the engine the deck, and an engine built again the same deck, at once', async () => {
    const made = await start();
    expect(engines).toHaveLength(1);
    const cards: DeckCard[] = DECK.cards.map((card) => ({ ...card }));
    made.setDeck({ ...DECK, cards });
    expect(running().told).toEqual([['deck', DECK, false]]);

    // The page measures its cards again into the same objects: what was said stays as said.
    const [first] = cards;
    if (first) first.x = 9999;
    rebuild();
    expect(engines).toHaveLength(2);
    expect(engines[0]?.disposed).toBe(true);
    expect(running().told).toEqual([
      ['inset', {}, true],
      ['deck', DECK, true],
      ['map', false, true],
    ]);
  });

  it('tells it that there is no deck, too: before any was set, and once it is taken away', async () => {
    const made = await start();
    rebuild();
    expect(running().told).toContainEqual(['deck', null, true]);

    made.setDeck(DECK);
    made.setDeck(null);
    expect(running().told.slice(-2)).toEqual([
      ['deck', DECK, false],
      ['deck', null, false],
    ]);
    rebuild();
    expect(running().told).toContainEqual(['deck', null, true]);
    expect(running().told).not.toContainEqual(['deck', DECK, true]);
  });

  it('cuts when asked to, and always under reduced motion, as for the inset', async () => {
    const made = await start();
    made.setDeck(DECK, { cut: true });
    made.setPanelInset({ right: 372, left: 420 }, { cut: true });
    expect(running().told).toEqual([
      ['deck', DECK, true],
      ['inset', { right: 372, left: 420 }, true],
    ]);
    made.dispose();
    engines.length = 0;

    const calm = await start(true);
    calm.setDeck(DECK);
    calm.setPanelInset({ right: 372, left: 420 });
    expect(running().told).toEqual([
      ['deck', DECK, true],
      ['inset', { right: 372, left: 420 }, true],
    ]);
  });

  it('passes on what stands on the left, and tells an engine built again that as well', async () => {
    const made = await start();
    const inset = { top: 64, right: 372, bottom: 0, left: 420, frameTop: 0 };
    made.setPanelInset(inset);
    expect(running().told).toEqual([['inset', inset, false]]);
    rebuild();
    expect(running().told[0]).toEqual(['inset', inset, true]);
  });

  it('tells nothing to an engine that is gone', async () => {
    const made = await start();
    made.dispose();
    made.setDeck(DECK);
    made.setPanelInset({ left: 420 });
    expect(running().told).toEqual([]);
    expect(running().disposed).toBe(true);
  });
});
