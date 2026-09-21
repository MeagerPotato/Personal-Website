import { Mesh, MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from './AssetStore';

const geometryOf = (handle: { object: { children: unknown[] } }): Mesh['geometry'] => {
  const mesh = handle.object.children.find((child): child is Mesh => child instanceof Mesh);
  if (!mesh) throw new Error('no mesh');
  return mesh.geometry;
};

describe('AssetStore', () => {
  it('builds a model on first use and shares its geometry between uses', () => {
    const store = new AssetStore();
    const material = new MeshBasicMaterial();
    const first = store.acquire('rocket', material);
    const second = store.acquire('rocket', material);

    expect(geometryOf(first)).toBe(geometryOf(second));
    expect(first.object).not.toBe(second.object);
    expect(geometryOf(first).getAttribute('position').count).toBeGreaterThan(100);
    expect(geometryOf(first).getAttribute('color').itemSize).toBe(3);
  });

  it('frees the geometry with the last use, and leaves the material to its owner', () => {
    const store = new AssetStore();
    const material = new MeshBasicMaterial();
    const materialDisposed = vi.fn();
    material.addEventListener('dispose', materialDisposed);

    const first = store.acquire('rocket', material);
    const second = store.acquire('rocket', material);
    const geometryDisposed = vi.fn();
    geometryOf(first).addEventListener('dispose', geometryDisposed);

    const scene = new Scene();
    scene.add(first.object);
    first.release();
    expect(first.object.parent).toBeNull();
    expect(geometryDisposed).not.toHaveBeenCalled();

    first.release(); // a second release must not count twice
    expect(geometryDisposed).not.toHaveBeenCalled();

    second.release();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).not.toHaveBeenCalled();

    // Used again afterwards, it is simply built again.
    expect(geometryOf(store.acquire('rocket', material))).not.toBe(geometryOf(first));
  });

  it('exposes the sockets of a model as objects to parent things to', () => {
    const store = new AssetStore();
    const handle = store.acquire('rocket', new MeshBasicMaterial());
    const engine = handle.socket('engine');

    expect(engine.parent).toBe(handle.object);
    expect(engine.position.z).toBeLessThan(-0.8);
    expect(() => handle.socket('cupholder')).toThrow(/no socket 'cupholder'/);
  });

  it('frees everything still in use when it is disposed, and refuses new work', () => {
    const store = new AssetStore();
    const handle = store.acquire('flame', new MeshBasicMaterial());
    const geometryDisposed = vi.fn();
    geometryOf(handle).addEventListener('dispose', geometryDisposed);

    store.dispose();
    store.dispose();
    expect(geometryDisposed).toHaveBeenCalledTimes(1);

    handle.release(); // late, and harmless
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(() => store.acquire('rocket', new MeshBasicMaterial())).toThrow(/after dispose/);
  });
});
