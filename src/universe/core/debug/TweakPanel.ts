import GUI from 'lil-gui';
import { refreshToonLook } from '../../design/materials';
import { tuning } from '../../design/tuning';
import type { ShipSystem } from '../../ship/ShipSystem';
import type { System } from '../Engine';
import type { InputSystem } from '../input/InputSystem';
import { addControls, copyText } from './guiControls';
import { IntentRecorder, ReplaySource, type Recording } from './IntentRecorder';

/** The blocks of design/tuning.ts that are read every frame, so a change shows at once. */
const LIVE_BLOCKS = [
  'flight',
  'assist',
  'cushion',
  'dock',
  'input',
  'chaseCam',
  'orbitCam',
  'cameraRig',
  'ship',
  'shading',
] as const;

/**
 * DEV ONLY (main.ts imports it behind `import.meta.env.DEV`, and verify-dist proves that no build
 * contains it). Open with `?tweak`. Sliders for the live blocks of design/tuning.ts, a button that
 * copies their values as JSON to paste back into that file, and the flight recorder.
 *
 * `tuning` is read-only to TypeScript and an ordinary object to JavaScript; this is the one place
 * that writes to it.
 */
export class TweakPanel implements System {
  private readonly gui = new GUI({ title: 'Tuning (dev only)' });
  private readonly recorder = new IntentRecorder();
  private lastRecording: Recording | null = null;
  private replay: ReplaySource | null = null;

  constructor(private readonly targets: { input: InputSystem; ship: ShipSystem }) {
    this.gui.domElement.setAttribute('data-flight-keys', 'off');
    this.gui.domElement.style.top = '4.75rem'; // below the HUD's top bar
    for (const block of LIVE_BLOCKS) {
      const folder = this.gui.addFolder(block);
      folder.close();
      addControls(folder, tuning[block] as unknown as Record<string, unknown>, refreshToonLook);
    }

    const actions = {
      'copy tuning as JSON': () => copyText(this.snapshot()),
      'record / stop': () => this.toggleRecording(),
      'replay the last recording': () => this.startReplay(),
    };
    for (const name of Object.keys(actions)) this.gui.add(actions, name as keyof typeof actions);
  }

  fixedUpdate(): void {
    this.recorder.capture(this.targets.input.current);
  }

  dispose(): void {
    this.stopReplay();
    this.gui.destroy();
  }

  private snapshot(): string {
    const live = Object.fromEntries(LIVE_BLOCKS.map((block) => [block, tuning[block]]));
    return JSON.stringify(live, null, 2);
  }

  private toggleRecording(): void {
    if (!this.recorder.recording) {
      this.recorder.begin(this.targets.ship.state);
      console.info('[recorder] recording...');
      return;
    }
    this.lastRecording = this.recorder.end(tuning.loop.stepHz);
    if (this.lastRecording) copyText(JSON.stringify(this.lastRecording));
  }

  private startReplay(): void {
    if (!this.lastRecording) return;
    this.stopReplay();
    this.targets.ship.restore(this.lastRecording.start);
    this.replay = new ReplaySource(this.lastRecording, () => this.stopReplay());
    this.targets.input.override = this.replay;
  }

  private stopReplay(): void {
    if (this.replay && this.targets.input.override === this.replay) {
      this.targets.input.override = null;
    }
    this.replay = null;
  }
}
