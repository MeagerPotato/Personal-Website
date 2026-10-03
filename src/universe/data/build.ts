import type { ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { worlds, type WorldRecipe } from '../design/worlds';
import { REACH } from '../design/worlds/reach';
import {
  RELAY_SLOTS,
  binaryOrbits,
  dockRadius,
  HAND_PLACE_WITHIN,
  handPlace,
  homeReach,
  homeRings,
  orbitPeriod,
  orbitPhase,
  reach,
  relayPhase,
  round,
  slotPosition,
  slotRoomProblems,
  stackRings,
} from './layout';
import type {
  BodyKind,
  LinkInput,
  ManifestBody,
  ManifestLane,
  ManifestSystem,
  Orbit,
  PageInput,
  ProjectInput,
  SystemInput,
  UniverseInput,
  UniverseManifest,
} from './types';

// Content in, galaxy out. A PURE function (docs/PLAN.md §5.4): it validates what a schema cannot
// (references, exactly-one-parent, moon depth), lays everything out, and returns the manifest that
// becomes /universe.json. It collects EVERY problem before throwing, so one build shows them all.

const L = tuning.layout;
const HOME = 'home';
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const bodyId = {
  system: (id: string): string => `system/${id}`,
  project: (id: string): string => `project/${id}`,
  page: (id: string): string => `page/${id}`,
  link: (id: string): string => `link/${id}`,
};

export class UniverseDataError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The universe has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    this.name = 'UniverseDataError';
  }
}

/** Plain code-unit order: the same on every machine, unlike localeCompare. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Older projects orbit closer in, and planned work without a date outermost (it moves in the day
 * it gets one). Ties break on id so the order never depends on input order.
 */
const byDateThenId = (a: ProjectInput, b: ProjectInput): number =>
  Number(a.date === undefined) - Number(b.date === undefined) ||
  compare(a.date ?? '', b.date ?? '') ||
  compare(a.id, b.id);

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) (seen.has(id) ? duplicates : seen).add(id);
  return [...duplicates].sort(compare);
}

/** A system with a place in the galaxy: one sun, or a binary star. validate() has checked it. */
type Slotted = SystemInput & { order: number; theme: ThemeKey };
const isSlotted = (system: SystemInput): system is Slotted =>
  system.order !== undefined && system.theme !== undefined;

/**
 * Which binary lists each sun of a binary (sun id -> binary id), and what is wrong with the
 * lists: a sun that is missing, listed twice or by two binaries, the binary itself, or a binary.
 */
function sunsOfBinaries(systems: readonly SystemInput[], problems: string[]): Map<string, string> {
  const byId = new Map(systems.map((system) => [system.id, system]));
  const binaryOf = new Map<string, string>();
  for (const binary of systems) {
    if (binary.suns === undefined) continue;
    const where = `binary "${binary.id}"`;
    if (binary.suns.length !== 2) {
      problems.push(
        `${where}: needs exactly two suns, primary first (found ${binary.suns.length})`,
      );
    }
    for (const [index, sun] of binary.suns.entries()) {
      const entry = byId.get(sun);
      if (sun === binary.id) problems.push(`${where}: lists itself`);
      else if (binary.suns.indexOf(sun) !== index) problems.push(`${where}: lists "${sun}" twice`);
      else if (entry === undefined) problems.push(`${where}: sun "${sun}" does not exist`);
      else if (entry.suns !== undefined) problems.push(`${where}: sun "${sun}" is itself a binary`);
      else {
        const holder = binaryOf.get(sun);
        if (holder === undefined) binaryOf.set(sun, binary.id);
        else {
          problems.push(
            `system "${sun}" is listed as a sun by both "${holder}" and "${binary.id}"`,
          );
        }
      }
    }
  }
  return binaryOf;
}

function validate(input: UniverseInput): string[] {
  const problems: string[] = [];
  const systems = new Map(input.systems.map((system) => [system.id, system]));
  const projects = new Map(input.projects.map((project) => [project.id, project]));

  const links = input.links ?? [];
  for (const [label, ids] of [
    ['system', input.systems.map((entry) => entry.id)],
    ['project', input.projects.map((entry) => entry.id)],
    ['page', input.pages.map((entry) => entry.id)],
    ['link', links.map((entry) => entry.id)],
  ] as const) {
    for (const id of findDuplicates(ids)) problems.push(`${label} id "${id}" is used twice`);
  }

  // The content schema says most of this already, file by file; it is said again here for input
  // that does not come through it (tests, the journeys harness), and for what spans two files.
  const bySystemId = [...input.systems].sort((a, b) => compare(a.id, b.id));
  const binaryOf = sunsOfBinaries(bySystemId, problems);
  const orders = new Map<number, string>();
  for (const system of bySystemId) {
    if (system.id === HOME) problems.push(`system id "${HOME}" is reserved for the home system`);
    const binary = binaryOf.get(system.id);
    if (binary !== undefined) {
      // A sun of a binary goes where its binary goes (in its own colours, or its binary's).
      const own = { order: system.order, position: system.position };
      for (const key of ['order', 'position'] as const) {
        if (own[key] === undefined || own[key] === 'auto') continue;
        problems.push(
          `system "${system.id}" is listed as a sun by "${binary}", so it goes where ` +
            `"${binary}" goes: leave out its ${key}`,
        );
      }
      continue;
    }
    const label = system.suns === undefined ? 'system' : 'binary';
    if (system.order === undefined) {
      problems.push(
        system.suns === undefined
          ? `system "${system.id}" has no order and no binary lists it: give it an order (its ` +
              `place in the galaxy), or list it in a binary's suns`
          : `binary "${system.id}": needs an order, its place in the galaxy`,
      );
    } else if (!Number.isInteger(system.order) || system.order < 1) {
      problems.push(`${label} "${system.id}": order must be a whole number from 1 (0 is home)`);
    } else {
      const holder = orders.get(system.order);
      if (holder !== undefined) {
        problems.push(`systems "${holder}" and "${system.id}" both claim order ${system.order}`);
      } else {
        orders.set(system.order, system.id);
      }
    }
    // A stray (no order, and in no binary) has just been told to take an order or to join a
    // binary; whether it needs a theme depends on which, so it is not asked for one yet.
    if (system.theme === undefined && (system.order !== undefined || system.suns !== undefined)) {
      problems.push(`${label} "${system.id}": needs a theme, its colour family`);
    }
  }

  // Drafts are validated too: a draft is a finished entry that is not published yet.
  for (const project of [...input.projects].sort((a, b) => compare(a.id, b.id))) {
    const where = `project "${project.id}"`;
    if (project.date === undefined) {
      if (!project.planned) problems.push(`${where}: a date is required unless it is planned`);
    } else if (!YEAR_MONTH.test(project.date)) {
      problems.push(`${where}: date must look like "2026-08"`);
    }

    const hasSystem = project.system !== undefined;
    const hasParent = project.parent !== undefined;
    if (hasSystem === hasParent) {
      problems.push(`${where}: set exactly one of "system" (a planet) or "parent" (a moon)`);
    }
    const system = project.system === undefined ? undefined : systems.get(project.system);
    if (project.system !== undefined && system === undefined) {
      problems.push(`${where}: system "${project.system}" does not exist`);
    } else if (system?.suns !== undefined) {
      const suns = system.suns.map((sun) => `"${sun}"`).join(' or ');
      problems.push(
        `${where}: "${system.id}" is a binary star; its planets orbit one of its suns: ` +
          `set system to ${suns}`,
      );
    }
    if (project.parent !== undefined) {
      const parent = projects.get(project.parent);
      if (project.parent === project.id) problems.push(`${where}: cannot be its own parent`);
      else if (parent === undefined) {
        problems.push(`${where}: parent "${project.parent}" does not exist`);
      } else {
        if (parent.parent !== undefined) {
          problems.push(
            `${where}: parent "${parent.id}" is itself a moon; moons cannot have moons`,
          );
        }
        if (parent.draft && !project.draft) {
          problems.push(`${where}: is published, but its parent "${parent.id}" is a draft`);
        }
      }
    }
    for (const target of project.related) {
      if (target === project.id) problems.push(`${where}: lists itself in "related"`);
      else if (!projects.has(target)) problems.push(`${where}: related "${target}" does not exist`);
    }
  }

  const homes = input.pages.filter((page) => page.dock === 'home');
  if (homes.length !== 1) {
    problems.push(`exactly one page must have dock "home" (found ${homes.length})`);
  }
  for (const dock of ['station', 'satellite'] as const) {
    const pages = input.pages.filter((page) => page.dock === dock);
    if (pages.length > 1) {
      const ids = pages.map((page) => `"${page.id}"`).join(', ');
      problems.push(`only one page may have dock "${dock}" (found ${ids})`);
    }
  }

  problems.push(...linkProblems(links));
  return problems;
}

/**
 * Relays share the satellite's ring, each on a slot of its own, and each stands for a profile on
 * another site: never a page of this one, which a body that cannot be docked at could not open.
 */
function linkProblems(links: readonly LinkInput[]): string[] {
  const problems: string[] = [];
  const holders = new Map<number, string>();
  for (const link of [...links].sort((a, b) => compare(a.id, b.id))) {
    const where = `link "${link.id}"`;
    if (!Number.isInteger(link.slot) || link.slot < 1 || link.slot >= RELAY_SLOTS) {
      problems.push(`${where}: slot must be 1 to ${RELAY_SLOTS - 1} (0 is the Contact satellite)`);
    } else {
      const holder = holders.get(link.slot);
      if (holder === undefined) holders.set(link.slot, link.id);
      else problems.push(`${where}: slot ${link.slot} is taken by "${holder}"`);
    }
    if (!/^https:\/\/[^/]/.test(link.href)) {
      problems.push(`${where}: href must be an https URL on another site`);
    }
  }
  const relay = dockRadius(L.home.relayRadius);
  const satellite = dockRadius(L.home.satelliteRadius);
  if (links.length > 0 && relay > satellite) {
    problems.push(
      `tuning.layout.home.relayRadius is ${L.home.relayRadius} u: a relay's docking ring ` +
        `(${round(relay)} u) must fit within the satellite's (${round(satellite)} u), whose ring ` +
        'it shares, or the home system would reach further than the layout allows for.',
    );
  }
  return problems;
}

function makeOrbit(id: string, radius: number): Orbit {
  return {
    radius: round(radius),
    phase: round(orbitPhase(id), 4),
    periodSec: round(orbitPeriod(radius), 1),
  };
}

function projectBody(
  project: ProjectInput,
  kind: Extract<BodyKind, 'planet' | 'moon'>,
  system: string,
  parent: string,
  radius: number,
  orbitRadius: number,
): ManifestBody {
  const id = bodyId.project(project.id);
  return {
    id,
    kind,
    title: project.title,
    href: project.href,
    system,
    parent,
    radius,
    dockRadius: round(dockRadius(radius)),
    orbit: makeOrbit(id, orbitRadius),
    seed: project.seed ?? project.id,
    biome: project.biome,
    rings: project.rings,
    decorMoons: project.decorMoons,
    flagship: project.flagship,
    ...(project.planned ? { planned: true as const } : {}),
  };
}

function buildHomeSystem(pages: readonly PageInput[]): {
  system: ManifestSystem;
  bodies: ManifestBody[];
} {
  const homePage = pages.find((page) => page.dock === 'home');
  if (homePage === undefined) throw new UniverseDataError(['no page has dock "home"']);

  const centerId = bodyId.page(homePage.id);
  const centerDock = dockRadius(L.home.planetRadius);
  const bodies: ManifestBody[] = [
    {
      id: centerId,
      kind: 'home',
      title: homePage.title,
      href: homePage.href,
      system: HOME,
      parent: null,
      radius: L.home.planetRadius,
      dockRadius: round(centerDock),
      orbit: null,
      seed: homePage.id,
      biome: L.home.biome,
    },
  ];

  // Both rings are always reserved, station inside satellite, whether or not their pages exist
  // yet: publishing one can then never move the other (data/layout.ts, homeRings).
  const rings = homeRings();
  for (const { item: slot, radius: orbitRadius } of rings) {
    const page = pages.find((candidate) => candidate.dock === slot.kind);
    if (page === undefined) continue;
    const id = bodyId.page(page.id);
    bodies.push({
      id,
      kind: slot.kind,
      title: page.title,
      href: page.href,
      system: HOME,
      parent: centerId,
      radius: slot.radius,
      dockRadius: round(slot.footprint),
      orbit: makeOrbit(id, orbitRadius),
      seed: page.id,
    });
  }

  return {
    system: {
      id: HOME,
      name: 'Home',
      theme: L.home.theme,
      position: [0, 0],
      radius: round(homeReach()),
      center: centerId,
    },
    bodies,
  };
}

/**
 * Allen's profiles elsewhere, as relays on the Contact satellite's ring: its radius and its
 * period, each `slot` steps of 45 degrees ahead of it (data/layout.ts, relayPhase). The ring is
 * reserved whether or not the Contact page exists, and so are the slots, so a relay is where it
 * is whatever else is published. Nothing can dock at one (`docks: false`): it opens another site.
 */
function buildLinks(links: readonly LinkInput[], pages: readonly PageInput[]): ManifestBody[] {
  const center = pages.find((page) => page.dock === 'home');
  const ring = homeRings().find(({ item }) => item.kind === 'satellite');
  if (center === undefined || ring === undefined) return [];
  // The satellite's own angle, as its body has it (a Contact page by any other id is still it).
  const satellite = pages.find((page) => page.dock === 'satellite')?.id ?? 'contact';
  const satellitePhase = round(orbitPhase(bodyId.page(satellite)), 4);
  const radius = L.home.relayRadius;
  return [...links]
    .sort((a, b) => a.slot - b.slot)
    .map((link) => {
      const id = bodyId.link(link.id);
      return {
        id,
        kind: 'link' as const,
        title: link.title,
        href: link.href,
        system: HOME,
        parent: bodyId.page(center.id),
        radius,
        dockRadius: round(dockRadius(radius)),
        orbit: {
          radius: round(ring.radius),
          phase: round(relayPhase(satellitePhase, link.slot), 4),
          periodSec: round(orbitPeriod(ring.radius), 1),
        },
        seed: id,
        docks: false as const,
      };
    });
}

interface Family {
  /** The sun, still at the centre of its slot (`orbit: null`): a binary sets it circling. */
  sun: ManifestBody;
  /** Its planets, innermost first, each followed by its moons. */
  bodies: ManifestBody[];
  /** How far it reaches from the sun: its outermost docking ring, u. */
  reach: number;
}

/**
 * A sun and everything round it: its planets on rings by date (older closer in), each planet's
 * moons stacked round it. A system with one sun is one family; a binary star is two, whose suns
 * circle their common centre. Every body is filed under `system`, the one that owns the slot.
 */
function buildFamily(sun: SystemInput, system: string, projects: readonly ProjectInput[]): Family {
  const sunId = bodyId.system(sun.id);
  const sunDock = dockRadius(L.sunRadius);
  const body: ManifestBody = {
    id: sunId,
    kind: 'sun',
    title: sun.name,
    href: sun.href,
    system,
    parent: null,
    radius: L.sunRadius,
    dockRadius: round(sunDock),
    orbit: null,
    seed: sun.id,
  };

  const planets = projects
    .filter((project) => project.system === sun.id)
    .map((project) => {
      const radius = L.planetRadius[project.size];
      const dock = dockRadius(radius);
      const moons = projects
        .filter((candidate) => candidate.parent === project.id)
        .map((moon) => {
          const moonRadius = L.moonRadius[moon.size];
          return { project: moon, radius: moonRadius, footprint: dockRadius(moonRadius) };
        });
      const moonRings = stackRings(moons, dock + L.moonGap, L.moonGap);
      return { project, radius, moonRings, footprint: reach(moonRings, dock) };
    });

  const rings = stackRings(planets, L.sunRadius + L.sunClearance, L.orbitGap, L.orbitStart);
  const bodies: ManifestBody[] = [];
  for (const { item: planet, radius: orbitRadius } of rings) {
    const planetId = bodyId.project(planet.project.id);
    bodies.push(projectBody(planet.project, 'planet', system, sunId, planet.radius, orbitRadius));
    for (const { item: moon, radius: moonOrbit } of planet.moonRings) {
      bodies.push(projectBody(moon.project, 'moon', system, planetId, moon.radius, moonOrbit));
    }
  }
  return { sun: body, bodies, reach: reach(rings, sunDock) };
}

interface Built {
  /** Every body of the slot, in manifest order. */
  bodies: ManifestBody[];
  /** How far it reaches from the slot's centre, u. */
  reach: number;
  /** The body the slot's system names as its centre. */
  center: string;
}

/** A system with one sun: one family, the sun at the centre of the slot. */
function buildSystem(
  system: SystemInput,
  projects: readonly ProjectInput[],
  problems: string[],
): Built {
  const family = buildFamily(system, system.id, projects);
  if (family.reach > L.maxSystemRadius) {
    problems.push(
      `system "${system.id}" reaches ${round(family.reach)} u, past the ${L.maxSystemRadius} u ` +
        'limit: it would crowd its neighbours. Move projects to another system, turn some into ' +
        'moons, or revisit tuning.layout.',
    );
  }
  return { bodies: [family.sun, ...family.bodies], reach: family.reach, center: family.sun.id };
}

/**
 * A binary star: two families, each laid out as a system's is, whose suns circle the binary's
 * centre on opposite sides (layout.ts, binaryOrbits). The primary is the first of `suns`, as
 * the content says: never worked out from sizes, which change.
 */
function buildBinary(
  binary: SystemInput,
  [primary, secondary]: readonly [SystemInput, SystemInput],
  projects: readonly ProjectInput[],
  problems: string[],
): Built {
  const a = buildFamily(primary, binary.id, projects);
  const b = buildFamily(secondary, binary.id, projects);
  const pair = binaryOrbits(a.reach, b.reach);
  // The phase and the one period are rounded BEFORE the second sun's phase is taken from the
  // first, so that the two stay opposite for ever, as the manifest says them.
  const phase = round(orbitPhase(bodyId.system(binary.id)), 4);
  const periodSec = round(pair.periodSec, 1);

  if (pair.reach > L.maxSystemRadius) {
    problems.push(
      `binary "${binary.id}" reaches ${round(pair.reach)} u (${primary.name} ` +
        `${round(a.reach)}, ${secondary.name} ${round(b.reach)}, ${L.binaryGap} apart), past ` +
        `the ${L.maxSystemRadius} u limit: it would crowd its neighbours. Move a project to ` +
        'another system, turn one into a moon, or revisit tuning.layout (a new limit moves ' +
        'every system: docs/PLAN.md §5.4).',
    );
  }

  // A sun that wears a family of its own says so; one that does not wears its binary's.
  const own = (sun: SystemInput): { theme?: ThemeKey } =>
    sun.theme === undefined ? {} : { theme: sun.theme };
  return {
    bodies: [
      { ...a.sun, ...own(primary), orbit: { radius: round(pair.a), phase, periodSec } },
      ...a.bodies,
      {
        ...b.sun,
        ...own(secondary),
        orbit: { radius: round(pair.b), phase: round(phase + Math.PI, 4), periodSec },
      },
      ...b.bodies,
    ],
    reach: pair.reach,
    center: a.sun.id,
  };
}

/**
 * A system placed by hand keeps to the room of its own slot: beside the centre of every other
 * slot there must still be room for a full-size system (data/layout.ts, `handPlace`), so that no
 * other system, there now or added later, can tell that this one was placed by hand. If it has
 * outgrown its place, it is the one to go: further out towards its own slot's centre, or back
 * onto it. Nothing else moves.
 */
function handPlacedProblems(
  system: Slotted,
  position: readonly [number, number],
  reach: number,
): string[] {
  const place = handPlace(system.order, position);
  const label = system.suns === undefined ? 'system' : 'binary';
  if (place.fromHub > HAND_PLACE_WITHIN) {
    return [
      `${label} "${system.id}" is placed by hand at (${position[0]}, ${position[1]}), ` +
        `${round(place.fromHub)} u from the hub of the honeycomb (slot 1): the build can hold a ` +
        `place by hand clear of every other slot only within ${HAND_PLACE_WITHIN} u of it. ` +
        `Leave the position out (the system then stands on the centre of its own slot ` +
        `${system.order}), or place it nearer (docs/PLAN.md §5.4).`,
    ];
  }
  if (reach <= place.room) return [];
  const [x, z] = slotPosition(system.order);
  const room = place.room > 0 ? `room to reach ${round(place.room)} u` : 'no room at all';
  return [
    `${label} "${system.id}" is placed by hand at (${position[0]}, ${position[1]}), ` +
      `${round(place.distance)} u from the centre of slot ${place.slot}: beside a full-size ` +
      `system there (${L.maxSystemRadius} u, ${L.minSystemGap} u clear) it has ${room}, and it ` +
      `reaches ${round(reach)} u. Move its position further from slot ${place.slot}, towards the ` +
      `centre of its own slot ${system.order} at (${round(x)}, ${round(z)}), or leave the ` +
      `position out: on its slot's centre it has room for anything the build accepts. No other ` +
      `system moves either way (docs/PLAN.md §5.4).`,
  ];
}

/**
 * `reach`: how far each emblem world's solid reaches, in radii, by body id (design/worlds/reach.ts
 * unless a test says otherwise: its made-up galaxies reuse real ids for bodies of other sizes).
 * `recipes`: the worlds of their own (design/worlds.ts); a body with one is not drawn from its
 * rows, so it has no reach of theirs.
 */
export function buildUniverse(
  input: UniverseInput,
  reach: Readonly<Partial<Record<string, number>>> = REACH,
  recipes: Readonly<Partial<Record<string, WorldRecipe>>> = worlds,
): UniverseManifest {
  const problems = validate(input);
  if (problems.length > 0) throw new UniverseDataError(problems);

  const projects = input.projects
    .filter((project) => input.includeDrafts || !project.draft)
    .sort(byDateThenId);
  const published = new Set(projects.map((project) => project.id));

  const home = buildHomeSystem(input.pages);
  const systems: ManifestSystem[] = [home.system];
  const bodies: ManifestBody[] = [...home.bodies, ...buildLinks(input.links ?? [], input.pages)];
  // Systems and binaries, in the order of their slots. Suns of a binary go where it goes.
  const slotted = input.systems.filter(isSlotted).sort((a, b) => a.order - b.order);
  const byId = new Map(input.systems.map((system) => [system.id, system]));
  // A slot too small for what the build accepts is refused, not moved (data/layout.ts). Only a
  // galaxy that stands on the honeycomb is held to its rooms: one whose every system is placed
  // by hand (the journeys harness trying another formula) answers to the tripwire below alone.
  const onHoneycomb = slotted.some((system) => system.position === 'auto');
  if (onHoneycomb) problems.push(...slotRoomProblems());

  for (const system of slotted) {
    // A binary's two suns exist: validate() has seen to it.
    const [primary, secondary] = (system.suns ?? []).flatMap((id) => byId.get(id) ?? []);
    const built =
      primary !== undefined && secondary !== undefined
        ? buildBinary(system, [primary, secondary], projects, problems)
        : buildSystem(system, projects, problems);
    bodies.push(...built.bodies);

    if (onHoneycomb && system.position !== 'auto') {
      problems.push(...handPlacedProblems(system, system.position, built.reach));
    }
    const [x, z] = system.position === 'auto' ? slotPosition(system.order) : system.position;
    systems.push({
      id: system.id,
      name: system.name,
      theme: system.theme,
      position: [round(x), round(z)],
      radius: round(built.reach),
      center: built.center,
    });
  }

  for (const [index, a] of systems.entries()) {
    for (const b of systems.slice(index + 1)) {
      const distance = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
      const needed = a.radius + b.radius + L.minSystemGap;
      if (distance < needed) {
        problems.push(
          `systems "${a.id}" and "${b.id}" are ${round(distance)} u apart but need ${round(needed)} u`,
        );
      }
    }
  }
  if (problems.length > 0) throw new UniverseDataError(problems);

  // A lane to an unpublished draft is simply not drawn yet; it appears when the draft ships.
  const lanes = new Map<string, ManifestLane>();
  for (const project of projects) {
    for (const target of project.related) {
      if (!published.has(target)) continue;
      const [a, b] = [bodyId.project(project.id), bodyId.project(target)].sort(compare);
      if (a !== undefined && b !== undefined) lanes.set(`${a}|${b}`, { a, b });
    }
  }

  // An emblem world's solid reaches past its radius (design/worlds/reach.ts): the collision field
  // takes that as its surface, rounded UP to the hundredth (rounded to the nearest, a surface
  // could sit a few thousandths inside what is drawn). Its cushion must still fit under its
  // docking ring, and that room depends on the body's kind and size, which content chooses: a
  // moon made a planet, or a size changed, can leave a world too big for its ring. A body that a
  // recipe in design/worlds.ts takes off its rows is drawn as the recipe says (world/looks.ts,
  // lookOf), so the reach of its rows is not its own.
  const { depth } = tuning.cushion;
  const solid = bodies.map((body) => {
    const declared = recipes[body.id] === undefined ? (reach[body.id] ?? 1) : 1;
    if (!(declared > 1)) return body;
    const solidRadius = Math.ceil(body.radius * declared * 100 - 1e-6) / 100;
    if (solidRadius + depth > body.dockRadius + 1e-9) {
      const room = Math.floor(((body.dockRadius - depth) / body.radius) * 100 + 1e-6) / 100;
      problems.push(
        `"${body.id}" reaches ${declared} radii (design/worlds/reach.ts), but a ${body.kind} ` +
          `of radius ${body.radius} u has room for ${room}: its cushion (${depth} u) needs its ` +
          `docking ring at ${round(solidRadius + depth)} u, not ${body.dockRadius} u. Bring in ` +
          `what stands out in its rows (design/worlds/) and measure it again ` +
          `(tests/world-reach.test.ts), give it a size with room for it, or take it off its ` +
          `rows with a recipe in design/worlds.ts`,
      );
    }
    return { ...body, solidRadius };
  });
  if (problems.length > 0) throw new UniverseDataError(problems);

  // The home system is systems[0]; the first system of projects, by `order`, comes after it.
  const firstOfProjects = systems[1];
  const alsoAt: Record<string, string> = {};
  if (input.projectsHref !== undefined && firstOfProjects) {
    alsoAt[input.projectsHref] = firstOfProjects.center;
  }

  return {
    version: 2,
    systems,
    bodies: solid,
    lanes: [...lanes.keys()].sort(compare).flatMap((key) => lanes.get(key) ?? []),
    alsoAt,
  };
}
