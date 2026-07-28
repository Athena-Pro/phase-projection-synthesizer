/**
 * Modular MIDI control layer — built for the Novation FLKey 37, source-agnostic.
 *
 * The `MidiRouter` takes raw MIDI bytes from ANY source and dispatches them through an
 * editable binding map to high-level handlers. In the web/standalone build the bytes
 * come from the Web MIDI API (`connectWebMidi`); in the planned JUCE + WebView VST the
 * plugin processor forwards FL Studio's MIDI to the exact same `router.handleMessage`,
 * so nothing here has to be rewritten for the port (see docs/VST-PORT.md).
 *
 * What it handles: note on/off, control change (the 8 top knobs + mod strip), pitch
 * bend, transport (Play/Stop → sequencer), and navigation (presets + field focus).
 *
 * Two toggles, both important for the plugin context:
 *   - `enabled`      — master on/off for the whole layer.
 *   - `knobsEnabled` — gates ONLY the knob→parameter bindings, so inside FL Studio you
 *     can hand the physical knobs to the DAW's own automation without the app also
 *     grabbing them. Notes, pitch, mod, transport and nav stay live.
 *
 * The FLKey's exact CC numbers depend on its mode, so every binding is remappable via
 * MIDI-learn (`armLearn`) and `FLKEY37_DEFAULT_MAP` is only a starting point.
 */

import { SynthParams } from '../types';

/** A high-level thing an incoming control can drive. */
export type MidiActionTarget =
  | { kind: 'param'; key: keyof SynthParams } // absolute 0..1 → the param's range (a knob)
  | { kind: 'mod' } // mod wheel/strip → whatever `modTarget` points at
  | { kind: 'fieldValue' } // absolute set of the currently focused field
  | { kind: 'presetPrev' }
  | { kind: 'presetNext' }
  | { kind: 'fieldPrev' }
  | { kind: 'fieldNext' }
  | { kind: 'seqRun' }
  | { kind: 'seqStop' }
  | { kind: 'deciTrigger' }; // fire the deci-core patch generator

export interface CCBinding {
  cc: number;
  channel?: number; // undefined = any channel
  target: MidiActionTarget;
}

export interface MidiMap {
  ccBindings: CCBinding[];
  modTarget: keyof SynthParams; // what the mod strip controls
  pitchBendSemis: number; // ± range of the pitch-bend, in semitones
}

export interface MidiHandlers {
  onNoteOn?(note: number, velocity: number): void;
  onNoteOff?(note: number): void;
  /** A knob moved: value01 is 0..1, the caller scales it to the param's range. */
  onParam?(key: keyof SynthParams, value01: number): void;
  onPitchBend?(semitones: number): void;
  onFieldPrev?(): void;
  onFieldNext?(): void;
  onFieldValue?(value01: number): void;
  onPresetPrev?(): void;
  onPresetNext?(): void;
  onSeqRun?(): void;
  onSeqStop?(): void;
  /** A bound control fired the deci-core patch generator (button-style, on press). */
  onDeciTrigger?(): void;
  /** Fired when a learn binding is captured (for UI feedback). */
  onLearn?(target: MidiActionTarget, cc: number, channel: number): void;
}

export class MidiRouter {
  map: MidiMap;
  handlers: MidiHandlers = {};
  enabled = true;
  /** Gates knob→param bindings only — see the class doc. */
  knobsEnabled = true;

  private learnTarget: MidiActionTarget | null = null;

  constructor(map: MidiMap) {
    this.map = map;
  }

  /** Arm learn: the next incoming CC is bound to `target`. Pass null to cancel. */
  armLearn(target: MidiActionTarget | null) {
    this.learnTarget = target;
  }
  get learning(): boolean {
    return this.learnTarget !== null;
  }

  handleMessage(data: Uint8Array | number[]) {
    if (!this.enabled) return;
    const status = data[0];

    // System Real-Time (single-byte, no channel). Per Novation's docs the FLkey's
    // Play/Stop keys emit MIDI Start/Stop when they aren't driving a DAW directly, so
    // Start/Continue run the sequencer and Stop stops it. Timing clock (0xF8), active
    // sensing (0xFE) and reset (0xFF) are ignored so they can't spam the transport.
    if (status >= 0xf8) {
      if (status === 0xfa || status === 0xfb) this.handlers.onSeqRun?.();
      else if (status === 0xfc) this.handlers.onSeqStop?.();
      return;
    }

    const d1 = data[1];
    const d2 = data[2];
    const cmd = status & 0xf0;
    const channel = status & 0x0f;

    if (cmd === 0x90 && d2 > 0) {
      this.handlers.onNoteOn?.(d1, d2);
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      this.handlers.onNoteOff?.(d1);
    } else if (cmd === 0xe0) {
      const raw = ((d2 << 7) | d1) - 8192; // 14-bit, centered
      this.handlers.onPitchBend?.((raw / 8192) * this.map.pitchBendSemis);
    } else if (cmd === 0xb0) {
      if (this.learnTarget) {
        const target = this.learnTarget;
        this.bindLearned(d1, target);
        this.learnTarget = null;
        this.handlers.onLearn?.(target, d1, channel);
      } else {
        this.dispatchCC(d1, d2, channel);
      }
    }
  }

  private findBinding(cc: number, channel: number): CCBinding | undefined {
    return this.map.ccBindings.find(
      (b) => b.cc === cc && (b.channel === undefined || b.channel === channel)
    );
  }

  private dispatchCC(cc: number, value: number, channel: number) {
    const b = this.findBinding(cc, channel);
    if (!b) return;
    const v01 = value / 127;
    const pressed = value > 0; // button-style controls fire on press
    switch (b.target.kind) {
      case 'param':
        if (this.knobsEnabled) this.handlers.onParam?.(b.target.key, v01);
        break;
      case 'mod':
        this.handlers.onParam?.(this.map.modTarget, v01);
        break;
      case 'fieldValue':
        this.handlers.onFieldValue?.(v01);
        break;
      case 'presetPrev':
        if (pressed) this.handlers.onPresetPrev?.();
        break;
      case 'presetNext':
        if (pressed) this.handlers.onPresetNext?.();
        break;
      case 'fieldPrev':
        if (pressed) this.handlers.onFieldPrev?.();
        break;
      case 'fieldNext':
        if (pressed) this.handlers.onFieldNext?.();
        break;
      case 'seqRun':
        if (pressed) this.handlers.onSeqRun?.();
        break;
      case 'seqStop':
        if (pressed) this.handlers.onSeqStop?.();
        break;
      case 'deciTrigger':
        if (pressed) this.handlers.onDeciTrigger?.();
        break;
    }
  }

  /** Bind `target` to `cc`, dropping any prior binding on that CC or that param key. */
  private bindLearned(cc: number, target: MidiActionTarget) {
    this.map.ccBindings = this.map.ccBindings.filter((b) => {
      if (b.cc === cc) return false;
      if (
        target.kind === 'param' &&
        b.target.kind === 'param' &&
        b.target.key === target.key
      )
        return false;
      if (b.target.kind === target.kind && target.kind !== 'param') return false;
      return true;
    });
    this.map.ccBindings.push({ cc, target });
  }
}

/**
 * Default binding profile for the Novation FLKey 37.
 *
 * The 8 top knobs, the mod strip, pitch bend, transport and the pattern/track
 * navigation buttons. The CC numbers below are the FLKey's common "custom/plugin" mode
 * values and are a STARTING POINT only — the FLKey emits different CCs in different
 * modes, so anything that doesn't line up should be re-bound with MIDI-learn.
 */
export function FLKEY37_DEFAULT_MAP(): MidiMap {
  return {
    pitchBendSemis: 2,
    modTarget: 'cutoff', // mod strip → filter cutoff by default
    ccBindings: [
      // 8 top rotary knobs (FLKey custom-mode default CC 21–28)
      { cc: 21, target: { kind: 'param', key: 'cutoff' } },
      { cc: 22, target: { kind: 'param', key: 'resonance' } },
      { cc: 23, target: { kind: 'param', key: 'dopplerMix' } },
      { cc: 24, target: { kind: 'param', key: 'parityMix' } },
      { cc: 25, target: { kind: 'param', key: 'crossMix' } },
      { cc: 26, target: { kind: 'param', key: 'frftMix' } },
      { cc: 27, target: { kind: 'param', key: 'motionDepth' } },
      { cc: 28, target: { kind: 'param', key: 'volume' } },
      // Mod strip (standard CC 1)
      { cc: 1, target: { kind: 'mod' } },
      // Transport → sequencer. The FLkey's Play/Stop primarily emit MIDI Real-Time
      // Start/Stop (handled in handleMessage); these CC fallbacks cover modes that send
      // CC instead. Remap via learn if your mode differs.
      { cc: 115, target: { kind: 'seqRun' } }, // Play
      { cc: 116, target: { kind: 'seqStop' } }, // Stop
      // Navigation: pattern up/down → presets, track left/right → field focus
      { cc: 103, target: { kind: 'presetNext' } },
      { cc: 102, target: { kind: 'presetPrev' } },
      { cc: 105, target: { kind: 'fieldNext' } },
      { cc: 104, target: { kind: 'fieldPrev' } },
    ],
  };
}

/**
 * Attach the Web MIDI API to a router. Returns a disconnect function.
 * `onDevices` reports the connected input names (re-fired on hot-plug).
 */
export function connectWebMidi(
  router: MidiRouter,
  onDevices: (names: string[]) => void
): () => void {
  let cancelled = false;
  let access: MIDIAccess | null = null;
  const inputs: MIDIInput[] = [];

  if (!navigator.requestMIDIAccess) {
    onDevices([]);
    return () => {};
  }

  const attach = (a: MIDIAccess) => {
    inputs.forEach((i) => (i.onmidimessage = null));
    inputs.length = 0;
    const names: string[] = [];
    a.inputs.forEach((input) => {
      names.push(input.name || 'MIDI input');
      input.onmidimessage = (m) => router.handleMessage((m as MIDIMessageEvent).data);
      inputs.push(input);
    });
    onDevices(names);
  };

  navigator
    .requestMIDIAccess()
    .then((a) => {
      if (cancelled) return;
      access = a;
      attach(a);
      a.onstatechange = () => attach(a);
    })
    .catch(() => onDevices([]));

  return () => {
    cancelled = true;
    inputs.forEach((i) => {
      try {
        i.onmidimessage = null;
      } catch (_) {
        /* input already gone */
      }
    });
    if (access) access.onstatechange = null;
  };
}
