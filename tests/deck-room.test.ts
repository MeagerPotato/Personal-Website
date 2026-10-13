import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyPose, createPose } from '../src/universe/camera/CameraRig';
import { ChaseCam } from '../src/universe/camera/ChaseCam';
import { buildRocket } from '../src/universe/design/models/rocket';
import { tokens } from '../src/universe/design/tokens';
import { tuning } from '../src/universe/design/tuning';
import { clamp } from '../src/universe/sim/math';

// THE DECK'S ROOM. The flight deck sits at the bottom centre of the view, right under the ship,
// and neither knows of the other: where the ship is on the screen is the chase camera's and the
// model's business (tuning.chaseCam, tuning.camera, design/models/rocket.ts, the hover of
// tuning.ship), and how high the deck reaches is the stylesheet's (--deck-size and what the
// cluster adds round its plate). The camera never moves for the deck, so the deck is sized to
// what the ship leaves: this is the one place where the two are held against each other.
//
// A ship at rest hovers, and at the bottom of each bob its fins are the lowest thing of it. If
// this fails, the camera, the model or the hover changed, or the deck grew: look at a ship at
// rest in a window 576 px tall (the shortest with the whole cluster), and give --deck-size the
// room that is there now.

const CSS = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const REM = 16;

/** A number the stylesheet states, or a failure that says what is no longer there. */
function stated(pattern: RegExp, what: string): number[] {
  const found = CSS.match(pattern);
  if (!found) throw new Error(`global.css no longer says ${what}`);
  return found.slice(1).map(Number);
}

const [LEAST = 0, SHARE = 0, LESS = 0, MOST = 0] = stated(
  /--deck-size: clamp\(([\d.]+)rem, calc\(([\d.]+)svh - ([\d.]+)rem\), ([\d.]+)rem\);/,
  'how big the plate is',
);
// What the cluster adds to its plate: the chip above it and the chip below.
const [ROUND = 0] = stated(
  /--deck-top: calc\(var\(--deck-gap\) \+ var\(--deck-size\) \+ ([\d.]+)rem\);/,
  "where the deck's top is",
);
// The gap under it (more on a phone with a home bar, which has no cluster).
stated(/--deck-gap: max\(var\(--space-(3)\), env\(safe-area-inset-bottom\)\);/, 'the gap under it');
const GAP = Number.parseFloat(tokens.space[3]);

/** The top of the deck in a view this tall: px from the top of the view. */
function deckTop(height: number): number {
  const plate = clamp((SHARE / 100) * height - LESS * REM, LEAST * REM, MOST * REM);
  return height - (GAP + ROUND) * REM - plate;
}

/**
 * How far down the view the lowest point of a ship at rest is, as a share of its height: the
 * chase camera straight behind it, the model `lift` units off the flight plane (the hover).
 */
function lowestPoint(aspect: number, lift: number): number {
  const ship = { position: new Vector3(), heading: 0, speed: 0 };
  const pose = createPose();
  new ChaseCam(ship, { reducedMotion: false }).update(
    { elapsed: 0, dt: 1 / 60, alpha: 1, simTime: 0 },
    { aspect, freeWidth: 1, freeHeight: 1, freeTop: 0, freeLeft: 0 },
    pose,
  );
  const camera = new PerspectiveCamera(pose.fov, aspect, 0.5, 12_000);
  applyPose(camera, pose);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const { positions } = buildRocket().mesh;
  const point = new Vector3();
  let low = 1;
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i] ?? 0, (positions[i + 1] ?? 0) + lift, positions[i + 2] ?? 0);
    low = Math.min(low, point.project(camera).y);
  }
  // (Projected, the top of the view is 1 and the bottom -1.)
  return (1 - low) / 2;
}

/** The declarations of the first rule with exactly this selector, or a failure that names it. */
function rule(selector: string, from = CSS): string {
  const start = from.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`global.css has no rule "${selector}"`);
  const open = from.indexOf('{', start);
  return from.slice(open + 1, from.indexOf('}', open));
}

const { bobAmplitude } = tuning.ship;
const [, MIN_REM] = tuning.instruments.fullMinRem;

describe('the room under the ship', () => {
  it('finds the fins of a resting ship 81.3 % of the way down a view, at the bottom of its bob', () => {
    // On every screen wider than it is tall: the lens and the camera's place are the same.
    // (A browser's pixels say 81.25 %: the last row of a fin's tip is too thin to be seen.)
    for (const aspect of [1, 4 / 3, 16 / 9, 3.2]) {
      expect(lowestPoint(aspect, -bobAmplitude), `${aspect}`).toBeCloseTo(0.8128, 3);
    }
    // The hover: between there and 76.9 %, and 79.1 % for a ship that holds still (less motion).
    expect(lowestPoint(16 / 9, bobAmplitude)).toBeCloseTo(0.769, 2);
    expect(lowestPoint(16 / 9, 0)).toBeCloseTo(0.791, 2);
    // On a screen taller than it is wide the camera stands further back, and the ship is higher.
    expect(lowestPoint(3 / 4, -bobAmplitude)).toBeLessThan(0.8);
  });

  it('keeps the deck half a rem clear of them in every view with the whole cluster', () => {
    // From the shortest view that has the cluster (fullMinRem), a pixel at a time, at the widths
    // of a small window, a laptop and a wide screen.
    let least = Infinity;
    for (let height = MIN_REM * REM; height <= 1600; height += 1) {
      for (const width of [768, 1280, 2560]) {
        const fins = lowestPoint(width / height, -bobAmplitude) * height;
        least = Math.min(least, deckTop(height) - fins);
      }
    }
    // (To within the fin's last third of a pixel.)
    expect(least).toBeGreaterThanOrEqual(0.5 * REM - 0.35);
    // Not much more than that either, in a short view: the plate has all the room there is.
    expect(least).toBeLessThan(0.5 * REM);
  });

  it('gives the plate 64 px in the shortest view with the cluster, and 112 from 832 px up', () => {
    const plate = (height: number): number => height - (GAP + ROUND) * REM - deckTop(height);
    expect(plate(MIN_REM * REM)).toBe(64);
    expect(plate(650)).toBeCloseTo(77.9, 1);
    expect(plate(832)).toBe(112);
    expect(plate(1400)).toBe(112);
  });
});

// THE ROOM BETWEEN TWO COLUMNS OF CARDS. On a wide screen a page's content stands on BOTH sides
// of the body (src/shell/deck.ts, "the deck" in the stylesheet), and the engine's own layer still
// begins at the window's left edge: only its right edge follows the page (--panel-inset-right).
// So everything in that layer that is placed from its middle or from its left has to know what
// stands on the left (--panel-inset-left), as the dock prompt does (src/shell/panel-inset.test.ts
// holds that one). The flight deck came from a branch that had never met a left column: these
// are the four places where the two meet, and ui/flightdeck.test.ts holds the fifth, how big the
// deck may be (`setRoom`).
describe('the room between two columns of cards', () => {
  it('stands the cluster in the middle of what the cards leave free', () => {
    // Half the layer is the middle of what a side panel leaves; a left column moves that middle
    // half its own width further right.
    expect(rule('  .flight-deck')).toContain(
      'left: calc(50% + var(--panel-inset-left, 0px) / 2 - var(--deck-half));',
    );
  });

  it('gives the prompt beside it the left half of that, and no more', () => {
    const seated = rule('  html:has(.flight-deck[data-seated]) .dock-prompt');
    expect(seated).toContain('--prompt-x: calc(-100% - var(--deck-half) - var(--space-3));');
    expect(seated.replace(/\s+/g, ' ')).toContain(
      'max-width: calc( 50% - var(--panel-inset-left, 0px) / 2 - var(--deck-half) - var(--space-3) - var(--space-6) );',
    );
  });

  it('begins the strip’s row where the left column’s room ends', () => {
    // Every rule that ends in the strip (the first-visit card's, which only hides it, among them).
    const strips = [...CSS.matchAll(/\n +\.flight-deck\[data-layout='strip'\] \{([^}]*)\}/g)].map(
      (found) => found[1] ?? '',
    );
    // ONE of them says where the strip begins: the further in of the column's edge (which holds
    // that column's air already) and the strip's own inset...
    const placed = strips.filter((declarations) => /\bleft:/.test(declarations));
    expect(placed).toHaveLength(1);
    expect(placed[0]).toContain('left: max(var(--panel-inset-left, 0px), var(--strip-inset));');
    // ...and that inset is the Map button's from its own edge: a mouse's, then a finger's and a
    // short, narrow window's, which make it smaller without touching `left`.
    const insets = strips.flatMap(
      (declarations) => /--strip-inset: ([^;]+);/.exec(declarations)?.[1] ?? [],
    );
    expect(insets).toEqual([
      'max(var(--space-6), env(safe-area-inset-left))',
      'max(var(--space-4), env(safe-area-inset-left))',
      'max(var(--space-4), env(safe-area-inset-left))',
    ]);
  });

  it('lets the prompt slide both ways under a deck of cards: to its middle, and beside the cluster', () => {
    // The cards' block gives the prompt a transition of `left` (a card that opens moves the
    // middle). A rule that names `left` alone would take away the flight deck's slide of
    // `translate`, and the press that drops the prompt onto its ledge at once.
    const cards = "html[data-mode='universe']:has(.panel > main > [data-card])";
    const slide = rule(`    ${cards} .dock-prompt`).replace(/\s+/g, ' ');
    expect(slide).toContain(
      'transition: left var(--motion-slow) var(--motion-ease-out), translate var(--motion-base) var(--motion-ease-out);',
    );
    expect(rule(`    ${cards} .dock-prompt:active`)).toContain('transition-duration: 0s;');
    // The same slide as the prompt has everywhere else.
    expect(rule('  .dock-prompt')).toContain(
      'transition: translate var(--motion-base) var(--motion-ease-out);',
    );
  });

  it('keeps the two decks’ gaps apart, though they share a name', () => {
    // `--deck-gap` is the flight deck's on the root (how far its instruments stand from the
    // bottom of the view) and the cards' inside their panel (the space between two cards). The
    // instruments are in the engine's layer, never in the panel, so neither reads the other's.
    const root = rule("  html[data-mode='universe']");
    expect(root).toContain('--deck-gap: max(var(--space-3), env(safe-area-inset-bottom));');
    const panel = rule("    html[data-mode='universe'] .panel:has(> main > [data-card])");
    expect(panel).toContain('--deck-gap: var(--space-3);');
    // Whoever reads the flight deck's stands in the layer: the cluster, the minimap, and what
    // keeps above the cluster (--deck-top, worked out on the root from the root's gap).
    for (const selector of ['  .flight-deck', '  .minimap']) {
      expect(rule(selector), selector).toContain('bottom: var(--deck-gap);');
    }
    expect(root).toContain('--deck-top: calc(var(--deck-gap) + var(--deck-size) + 1.5rem);');
  });
});
