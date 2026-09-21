import { describe, expect, it } from 'vitest';
import { tuning } from '../../design/tuning';
import { copyShipState, createShipState } from '../../sim/flight';
import { createRng } from '../../sim/rng';
import type { FlightInput } from '../../sim/types';
import { ShipSystem } from '../../ship/ShipSystem';
import { AssetStore } from '../AssetStore';
import { InputSystem } from '../input/InputSystem';
import type { InputSource } from '../input/intents';
import { IntentRecorder, ReplaySource } from './IntentRecorder';

const STEP = 1 / tuning.loop.stepHz;

/** A pilot with a script: holds each random intent for a random while, like hands on keys. */
function scriptedPilot(seed: string): InputSource {
  const rng = createRng(seed);
  const held: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };
  let stepsLeft = 0;
  return {
    read(out) {
      if (stepsLeft === 0) {
        held.thrust = rng() < 0.7 ? 1 : 0;
        held.turn = Math.round(rng() * 2 - 1);
        held.brake = rng() < 0.15 ? 1 : 0;
        held.boost = rng() < 0.3;
        stepsLeft = 5 + Math.floor(rng() * 50);
      }
      stepsLeft -= 1;
      Object.assign(out, held);
    },
    dispose: () => undefined,
  };
}

describe('the flight recorder', () => {
  it('replays a flight to the same state, bit for bit', () => {
    const input = new InputSystem();
    input.add(scriptedPilot('a bumpy ride'));
    const ship = new ShipSystem({
      spawn: { x: 0, z: 0, heading: 0 },
      pilot: input,
      assets: new AssetStore(),
      reducedMotion: true,
    });
    const recorder = new IntentRecorder();

    // Fly for a while first, so the recording starts from a state with speed and spin in it.
    for (let i = 0; i < 300; i += 1) {
      input.fixedUpdate();
      ship.fixedUpdate(STEP);
    }
    recorder.begin(ship.state);
    expect(recorder.recording).toBe(true);
    for (let i = 0; i < 1800; i += 1) {
      input.fixedUpdate();
      recorder.capture(input.current);
      ship.fixedUpdate(STEP);
    }
    const flown = copyShipState(ship.state, createShipState());
    const recording = recorder.end(tuning.loop.stepHz);
    if (!recording) throw new Error('no recording');
    expect(recorder.recording).toBe(false);
    expect(recording.inputs).toHaveLength(1800 * 4);

    // Through JSON and back, as a bug report would carry it.
    const revived = JSON.parse(JSON.stringify(recording)) as typeof recording;
    let ended = 0;
    const replay = new ReplaySource(revived, () => (ended += 1));
    ship.restore(revived.start);
    input.override = replay;
    for (let i = 0; i < 1800; i += 1) {
      input.fixedUpdate();
      ship.fixedUpdate(STEP);
    }

    expect(ship.state).toEqual(flown); // toEqual on numbers is exact: no tolerance
    expect(ended).toBe(1);
    expect(replay.stepsLeft).toBe(0);
  });

  it('keeps every other hand off the stick while something overrides the input', () => {
    const input = new InputSystem();
    input.add({ read: (out) => void (out.thrust = 1), dispose: () => undefined });
    input.fixedUpdate();
    expect(input.current.thrust).toBe(1);

    input.override = { read: (out) => void (out.turn = -1), dispose: () => undefined };
    input.fixedUpdate();
    expect(input.current).toEqual({ thrust: 0, turn: -1, brake: 0, boost: false });

    input.override = null;
    input.fixedUpdate();
    expect(input.current.thrust).toBe(1);
  });

  it('flies nothing once a replay has run out', () => {
    const replay = new ReplaySource({
      version: 1,
      stepHz: 60,
      start: createShipState(),
      inputs: [1, 0.5, 0, 1],
    });
    const out: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };
    replay.read(out);
    expect(out).toEqual({ thrust: 1, turn: 0.5, brake: 0, boost: true });

    const after: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };
    replay.read(after);
    expect(after).toEqual({ thrust: 0, turn: 0, brake: 0, boost: false });
  });
});
