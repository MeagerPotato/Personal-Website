import { Group, Mesh, Object3D, type BufferGeometry, type Material } from 'three';
import { assets, type AssetId } from '../design/assets';
import type { System } from './Engine';
import { geometryFrom } from './geometry';

/** One use of a model. Whoever acquires it releases it. */
export interface AssetHandle {
  /** Add this to the scene graph. The model sits inside it, so the model can be swapped later. */
  readonly object: Group;
  /**
   * A named attachment point of the model (design/models/, or a named node of a .glb), as an
   * object to parent things to. Throws for a name the model does not have.
   */
  socket(name: string): Object3D;
  release(): void;
}

interface Entry {
  geometry: BufferGeometry;
  sockets: Readonly<Record<string, readonly [number, number, number]>>;
  uses: number;
}

/**
 * Hands out models by logical name (design/assets.ts). `acquire` is SYNCHRONOUS: a procedural
 * model is built on first use, and a file-based model (Phase 3) will show a placeholder inside
 * the same `object` until it arrives. So no caller ever waits for art, and none of them changes
 * when the art does.
 *
 * Geometry is shared between every use of a model and freed with the last one. The MATERIAL is
 * the caller's (its sun differs from place to place), and so is its disposal.
 */
export class AssetStore implements System {
  private readonly entries = new Map<AssetId, Entry>();
  private disposed = false;

  acquire(id: AssetId, material: Material): AssetHandle {
    if (this.disposed) throw new Error(`AssetStore: acquire('${id}') after dispose`);
    const entry = this.entries.get(id) ?? this.build(id);
    entry.uses += 1;

    const object = new Group();
    object.name = id;
    object.add(new Mesh(entry.geometry, material));

    const sockets = new Map<string, Object3D>();
    for (const [name, [x, y, z]] of Object.entries(entry.sockets)) {
      const socket = new Object3D();
      socket.name = `${id}:${name}`;
      socket.position.set(x, y, z);
      object.add(socket);
      sockets.set(name, socket);
    }

    let released = false;
    return {
      object,
      socket: (name) => {
        const socket = sockets.get(name);
        if (!socket) throw new Error(`AssetStore: '${id}' has no socket '${name}'`);
        return socket;
      },
      release: () => {
        if (released) return;
        released = true;
        object.removeFromParent();
        entry.uses -= 1;
        if (entry.uses === 0 && this.entries.get(id) === entry) {
          this.entries.delete(id);
          entry.geometry.dispose();
        }
      },
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.geometry.dispose();
    this.entries.clear();
  }

  private build(id: AssetId): Entry {
    const model = assets[id].build();
    const entry: Entry = { geometry: geometryFrom(model.mesh), sockets: model.sockets, uses: 0 };
    this.entries.set(id, entry);
    return entry;
  }
}
