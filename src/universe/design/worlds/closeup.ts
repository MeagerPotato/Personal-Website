/**
 * THE CLOSE-UP CHUNK: what a world adds when the ship is near it (near.ts) and how its parts move
 * (motion.ts), loaded together with import() by world/Galaxy.ts, at idle or when the ship first
 * comes near a world. Nothing the first frame needs lives here: far away every world is its
 * still, and no everyday part is missing from a still (tests/world-bodies.test.ts). Nothing in the
 * engine imports this module, near.ts or motion.ts statically, so the three are a file of their
 * own in the build.
 */
export { NEAR } from './near';
export { MOTION } from './motion';
