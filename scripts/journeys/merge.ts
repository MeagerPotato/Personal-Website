/** Every key optional, all the way down; arrays and numbers are replaced whole. */
export type DeepPartial<T> = {
  -readonly [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K] | number[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K] extends number
        ? number
        : T[K] extends string
          ? string
          : T[K] extends boolean
            ? boolean
            : T[K];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Write `patch` over `target` IN PLACE, recursing into objects that already exist (so whoever
 * holds a nested object sees the change). Keys are API: an unknown key, or a value of another
 * shape, is a typo and throws instead of being ignored.
 */
export function mergeInto(target: Record<string, unknown>, patch: object, path = ''): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) throw new Error(`unknown tuning key "${path}${key}"`);
    const current = target[key];
    if (isRecord(current)) {
      if (!isRecord(value)) throw new Error(`"${path}${key}" is a block: give it an object`);
      mergeInto(current, value, `${path}${key}.`);
    } else if (Array.isArray(current)) {
      if (!Array.isArray(value) || value.length !== current.length) {
        throw new Error(`"${path}${key}" is a list of ${current.length}`);
      }
      target[key] = [...(value as unknown[])];
    } else {
      if (typeof value !== typeof current) {
        throw new Error(`"${path}${key}" is a ${typeof current}, not a ${typeof value}`);
      }
      target[key] = value;
    }
  }
}
