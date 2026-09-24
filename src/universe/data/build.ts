import { tuning } from '../design/tuning';
import {
  dockRadius,
  homeReach,
  homeRings,
  orbitPeriod,
  orbitPhase,
  reach,
  round,
  slotPosition,
  slotRoomProblems,
  stackRings,
} from './layout';
import type {
  BodyKind,
  ManifestBody,
  ManifestLane,
  ManifestSystem,
  Orbit,
  PageInput,
  ProjectInput,
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
};

export class UniverseDataError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The universe has ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    this.name = 'UniverseDataError';
  }
}

/** Plain code-unit order: the same on every machine, unlike localeCompare. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Older projects orbit closer in. Ties break on id so the order never depends on input order. */
const byDateThenId = (a: ProjectInput, b: ProjectInput): number =>
  compare(a.date, b.date) || compare(a.id, b.id);

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) (seen.has(id) ? duplicates : seen).add(id);
  return [...duplicates].sort(compare);
}

function validate(input: UniverseInput): string[] {
  const problems: string[] = [];
  const systemIds = new Set(input.systems.map((system) => system.id));
  const projects = new Map(input.projects.map((project) => [project.id, project]));

  for (const [label, ids] of [
    ['system', input.systems.map((entry) => entry.id)],
    ['project', input.projects.map((entry) => entry.id)],
    ['page', input.pages.map((entry) => entry.id)],
  ] as const) {
    for (const id of findDuplicates(ids)) problems.push(`${label} id "${id}" is used twice`);
  }

  const orders = new Map<number, string>();
  for (const system of [...input.systems].sort((a, b) => compare(a.id, b.id))) {
    if (system.id === HOME) problems.push(`system id "${HOME}" is reserved for the home system`);
    if (!Number.isInteger(system.order) || system.order < 1) {
      problems.push(`system "${system.id}": order must be a whole number from 1 (0 is home)`);
    }
    const holder = orders.get(system.order);
    if (holder !== undefined) {
      problems.push(`systems "${holder}" and "${system.id}" both claim order ${system.order}`);
    } else {
      orders.set(system.order, system.id);
    }
  }

  // Drafts are validated too: a draft is a finished entry that is not published yet.
  for (const project of [...input.projects].sort((a, b) => compare(a.id, b.id))) {
    const where = `project "${project.id}"`;
    if (!YEAR_MONTH.test(project.date)) problems.push(`${where}: date must look like "2026-08"`);

    const hasSystem = project.system !== undefined;
    const hasParent = project.parent !== undefined;
    if (hasSystem === hasParent) {
      problems.push(`${where}: set exactly one of "system" (a planet) or "parent" (a moon)`);
    }
    if (project.system !== undefined && !systemIds.has(project.system)) {
      problems.push(`${where}: system "${project.system}" does not exist`);
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

export function buildUniverse(input: UniverseInput): UniverseManifest {
  const problems = validate(input);
  if (problems.length > 0) throw new UniverseDataError(problems);

  const projects = input.projects
    .filter((project) => input.includeDrafts || !project.draft)
    .sort(byDateThenId);
  const published = new Set(projects.map((project) => project.id));

  const home = buildHomeSystem(input.pages);
  const systems: ManifestSystem[] = [home.system];
  const bodies: ManifestBody[] = [...home.bodies];
  // A slot too small for what the build accepts is refused, not moved (data/layout.ts).
  if (input.systems.some((system) => system.position === 'auto')) {
    problems.push(...slotRoomProblems());
  }

  const sunDock = dockRadius(L.sunRadius);
  for (const system of [...input.systems].sort((a, b) => a.order - b.order)) {
    const sunId = bodyId.system(system.id);
    bodies.push({
      id: sunId,
      kind: 'sun',
      title: system.name,
      href: system.href,
      system: system.id,
      parent: null,
      radius: L.sunRadius,
      dockRadius: round(sunDock),
      orbit: null,
      seed: system.id,
    });

    const planets = projects
      .filter((project) => project.system === system.id)
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
    for (const { item: planet, radius: orbitRadius } of rings) {
      const planetId = bodyId.project(planet.project.id);
      bodies.push(
        projectBody(planet.project, 'planet', system.id, sunId, planet.radius, orbitRadius),
      );
      for (const { item: moon, radius: moonOrbit } of planet.moonRings) {
        bodies.push(projectBody(moon.project, 'moon', system.id, planetId, moon.radius, moonOrbit));
      }
    }

    const radius = reach(rings, sunDock);
    if (radius > L.maxSystemRadius) {
      problems.push(
        `system "${system.id}" reaches ${round(radius)} u, past the ${L.maxSystemRadius} u limit: ` +
          'it would crowd its neighbours. Move projects to another system, turn some into moons, ' +
          'or revisit tuning.layout.',
      );
    }

    const [x, z] = system.position === 'auto' ? slotPosition(system.order) : system.position;
    systems.push({
      id: system.id,
      name: system.name,
      theme: system.theme,
      position: [round(x), round(z)],
      radius: round(radius),
      center: sunId,
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

  // The home system is systems[0]; the first system of projects, by `order`, comes after it.
  const firstOfProjects = systems[1];
  const alsoAt: Record<string, string> = {};
  if (input.projectsHref !== undefined && firstOfProjects) {
    alsoAt[input.projectsHref] = firstOfProjects.center;
  }

  return {
    version: 1,
    systems,
    bodies,
    lanes: [...lanes.keys()].sort(compare).flatMap((key) => lanes.get(key) ?? []),
    alsoAt,
  };
}
