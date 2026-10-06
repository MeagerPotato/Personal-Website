import type { LandmarkTable } from '../../sim/landmarks';

/**
 * WHAT EACH CARD POINTS AT (sim/landmarks.ts): by body (its id in /universe.json), then by card
 * (the id of the card's heading: `rockets` is /about/#rockets). Opening the card turns the camera
 * to its landmark and ends the card's leader on it. A card that is not here points at its place
 * on a ring round the body (`tuning.deck`), so nothing has to be listed.
 *
 * A landmark is a latitude and a longitude in the body's own frame, in degrees, as a part is
 * stood on a world (`['s', lat, lon, ...]` in the rows): read it off the row of the part it is,
 * and name that part, so that tests/landmarks.test.ts can say when the part has moved on. Keep
 * the latitude between -15 and 85: the camera turns round the body and never climbs, so a
 * landmark on the pole or far underneath has no side to turn to.
 *
 * DESIGN SURFACE: the values are free to change. The keys are API: a body's id, and a heading's
 * id, which is a fragment people link to.
 */

/**
 * The longitude of piece `j` of a ring of `n` (the rows' `around`: bearings from north, the
 * first at `phase` radians), as a landmark counts longitude.
 */
const around = (n: number, phase: number, j: number): number =>
  180 - ((phase * 180) / Math.PI + (360 * j) / n);

/** The Resume station's five pods, in the page's own order (design/worlds/home.ts, `stop-pods`). */
const pod = (j: number) => ({ lat: 1, lon: around(5, 0.3, j), part: 'stop-pods' });

export const LANDMARKS: LandmarkTable = {
  // About Me. Rockets: the launch pad up north, where the ship's twin lifts off (near.ts).
  'page/about': {
    rockets: { lat: 80, lon: 30, part: 'launch-pad' },
  },
  // The Resume station. A pod for each section, each wearing that section's pictogram; and the
  // two pages on the mast, the PDF, for the way to reach Allen and to download it.
  'page/resume': {
    'resume-contact': { lat: 85, lon: 0, alt: 0.04, part: 'two-pages' },
    'resume-education': pod(0),
    'resume-experience': pod(1),
    'resume-leadership': pod(2),
    'resume-skills': pod(3),
    'resume-awards': pod(4),
  },
};
