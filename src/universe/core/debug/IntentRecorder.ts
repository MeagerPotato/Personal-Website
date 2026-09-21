import { copyShipState, createShipState } from '../../sim/flight';
import type { FlightInput, ShipState } from '../../sim/types';
import type { InputSource } from '../input/intents';

/**
 * A flight, as data: where the ship started and what the pilot asked for at every simulation
 * step. The simulation is deterministic (fixed steps, no clock, no Math.random), so replaying a
 * recording reproduces the flight EXACTLY, bit for bit. That turns "it felt wrong just there" into
 * something that can be attached to a bug report, replayed after a tuning change, or kept as a test.
 */
export interface Recording {
  version: 1;
  stepHz: number;
  start: ShipState;
  /** Four numbers per step: thrust, turn, brake, boost (0 or 1). */
  inputs: number[];
}

const FIELDS = 4;

export class IntentRecorder {
  private start: ShipState | null = null;
  private inputs: number[] = [];

  get recording(): boolean {
    return this.start !== null;
  }

  begin(start: Readonly<ShipState>): void {
    this.start = copyShipState(start, createShipState());
    this.inputs = [];
  }

  /** Call once per simulation step, after the inputs were merged. Does nothing unless recording. */
  capture(input: Readonly<FlightInput>): void {
    if (!this.start) return;
    this.inputs.push(input.thrust, input.turn, input.brake, input.boost ? 1 : 0);
  }

  end(stepHz: number): Recording | null {
    if (!this.start) return null;
    const recording: Recording = { version: 1, stepHz, start: this.start, inputs: this.inputs };
    this.start = null;
    this.inputs = [];
    return recording;
  }
}

/** Plays a recording back as THE input (InputSystem.override): one recorded intent per step. */
export class ReplaySource implements InputSource {
  private step = 0;

  constructor(
    private readonly recording: Recording,
    private readonly onEnd: () => void = () => undefined,
  ) {}

  get stepsLeft(): number {
    return Math.max(0, this.recording.inputs.length / FIELDS - this.step);
  }

  read(out: FlightInput): void {
    if (this.stepsLeft === 0) return;
    const at = this.step * FIELDS;
    const { inputs } = this.recording;
    out.thrust = inputs[at] ?? 0;
    out.turn = inputs[at + 1] ?? 0;
    out.brake = inputs[at + 2] ?? 0;
    out.boost = inputs[at + 3] === 1;
    this.step += 1;
    if (this.stepsLeft === 0) this.onEnd();
  }

  dispose(): void {
    this.step = this.recording.inputs.length / FIELDS;
  }
}
