import type { ModelData } from '../sim/meshBuilder';
import { buildPlanetRing, buildSatellite, buildStation } from './models/docks';
import { buildFlame } from './models/flame';
import { buildRocket } from './models/rocket';
import { tuning } from './tuning';

/**
 * THE ASSET MANIFEST: logical name -> where the model comes from (docs/PLAN.md §5.6). Logic asks
 * core/AssetStore.ts for 'rocket' and never learns whether that is generated code or a file, so
 * swapping art never touches logic.
 *
 * Today every model is PROCEDURAL: a function that builds it (design/models/). Nothing is fetched
 * before the first frame. The `gltf` kind (a .glb under public/models/, loaded lazily behind a
 * procedural placeholder) joins this union in Phase 3, together with the first real model.
 *
 * DESIGN SURFACE: models are free to change; asset names and socket names are API.
 */
export type AssetSource = { kind: 'procedural'; build: () => ModelData };

export const assets = {
  rocket: { kind: 'procedural', build: buildRocket },
  flame: { kind: 'procedural', build: buildFlame },
  station: { kind: 'procedural', build: buildStation },
  satellite: { kind: 'procedural', build: buildSatellite },
  planetRing: {
    kind: 'procedural',
    build: buildPlanetRing(tuning.world.ringOuterRadii / tuning.world.ringInnerRadii),
  },
} as const satisfies Record<string, AssetSource>;

export type AssetId = keyof typeof assets;
