import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { startMotionDetection, stopMotionDetection, MotionConfig, DEFAULT_MOTION_CONFIG, applyMotion } from './lib/motionEngine';
import { Looper } from './lib/looper';
import { LooperPanel } from './components/LooperPanel';
import { SynthParams } from './types';
import { AudioEngine, midiToFreq } from './lib/audioEngine';
import { SYNTH_PRESETS, FACTORY_BANKS } from './lib/presets';
import {
  USER_BANK,
  USER_SLOT_COUNT,
  UserSlot,
  loadUserSlots,
  saveUserSlots,
  firstEmptySlot,
  slotNameFor,
} from './lib/userSlots';
import { PARAM_SPECS } from './lib/paramSpecs';
import { LfoConfig, DEFAULT_LFOS, applyLfos, lfoActive } from './lib/lfo';
import { MidiRouter, connectWebMidi, FLKEY37_DEFAULT_MAP } from './lib/midi';
import Display, { DisplayMode } from './components/Display';
import VirtualKeyboard from './components/VirtualKeyboard';
import SynthControls from './components/SynthControls';
import LfoPanel from './components/LfoPanel';
import MidiPanel from './components/MidiPanel';
import DeciPanel, { DeciScope } from './components/DeciPanel';
import BufferPanel from './components/BufferPanel';
import {
  BufferTransformer,
  BufferParams,
  DEFAULT_BUFFER_PARAMS,
} from './lib/bufferTransformer';
import { generatePatch, generateNumberPatch, DEFAULT_DECI_MAP, FULL_DECI_MAP } from './lib/deciBridge';
import { HardwareButton } from './components/ui';
import PatchStrip, { PatchEntry } from './components/PatchStrip';

/** Parameter order for the controller's field-navigation keys. */
const NAV_ORDER = Object.keys(PARAM_SPECS) as (keyof SynthParams)[];

export interface SeqTransport {
  cmd: 'run' | 'stop';
  id: number;
}

const MemoControls = React.memo(SynthControls);
const MemoKeyboard = React.memo(VirtualKeyboard);

const DISPLAY_MODES: { id: DisplayMode; label: string }[] = [
  { id: 'scope', label: 'Scope' },
  { id: 'spect', label: 'Spect' },
  { id: 'tensor', label: 'Tensor' },
  { id: 'cp1', label: 'CP¹' },
  { id: 'orbit', label: 'Orbit' },
];

/** Top-level pages of the fixed VST frame. */
type MainTab = 'editor' | 'perform';
const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'perform', label: 'Perform · Keys' },
];

/** Neutralize timbre operators and master sends while preserving source, ADSR, and filter. */
function bypassEffects(p: SynthParams): SynthParams {
  return {
    ...p,
    crossMix: 0,
    crossDifference: 0,
    circulantOperatorStrength: 0,
    collatzGating: 0,
    padicTilt: 0,
    dirichletTwist: 0,
    heckeMix: 0,
    thetaPhase: 0,
    thetaHeat: 0,
    cyclotomicMix: 0,
    lowCouple: 0,
    spectralFold: 0,
    interfere: 0,
    zeroStretch: 0,
    zeroInsert: 0,
    frftMix: 0,
    motionDepth: 0,
    mobiusRotate: 0,
    mobiusBoost: 0,
    mobiusTilt: 0,
    mobiusParabolic: 0,
    cayleyLink: 0,
    harmonicExponent: 1,
    extendMix: 0,
    dopplerMix: 0,
    parityMix: 0,
  };
}

export default function App() {
  const [params, setParams] = useState<SynthParams>({
    ...SYNTH_PRESETS[0].params,
  });
  const [patchIndex, setPatchIndex] = useState(0);
  const [edited, setEdited] = useState(false);
  // Banks group the factory patches; the User bank holds the player's own, in localStorage.
  const [bank, setBank] = useState<string>(FACTORY_BANKS[0]);
  const [userSlots, setUserSlots] = useState<(UserSlot | null)[]>(() =>
    loadUserSlots(SYNTH_PRESETS[0].params)
  );
  const [displayMode, setDisplayMode] = useState<DisplayMode>('scope');
  const [mainTab, setMainTab] = useState<MainTab>('editor');
  const [vfd, setVfd] = useState<{ label: string; value: string } | null>(null);

  const looperRef = useRef<Looper | null>(null);
  const [looperState, setLooperState] = useState({ isRecording: false, isPlaying: false, events: 0, duration: 0 });
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [motionConfig, setMotionConfig] = useState<MotionConfig>(DEFAULT_MOTION_CONFIG);
  const [motionPitch, setMotionPitch] = useState(0);
  const [motionRoll, setMotionRoll] = useState(0);

  const [isEngineActive, setIsEngineActive] = useState(false);
  // Buffer transformer: a resynthesizer that reads the analysis ring diagonally. Like the
  // deci patcher it is a modular attachment with its own state, not part of a patch.
  const [bufferParams, setBufferParams] = useState<BufferParams>(DEFAULT_BUFFER_PARAMS);
  const bufferRef = useRef<BufferTransformer | null>(null);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [lastPlayedNote, setLastPlayedNote] = useState(48);
  const [fxBypass, setFxBypass] = useState(false);
  // Panic is a fire-and-forget event, not a value: the keyboard subscribes and silences
  // itself rather than us threading an ever-incrementing counter through as a prop.
  const panicBus = useMemo(() => new EventTarget(), []);

  // Assignable LFOs modulate on top of the base params: knobs and presets keep the
  // base value; the engine and display follow the modulated copy.
  const [lfos, setLfos] = useState<LfoConfig[]>(DEFAULT_LFOS);
  const [armed, setArmed] = useState<number | null>(null);
  const [lfoTick, setLfoTick] = useState(0);
  const anyLfoActive = lfos.some(lfoActive);

  useEffect(() => {
    if (!anyLfoActive) return;
    const id = setInterval(() => setLfoTick((t) => t + 1), 33);
    return () => clearInterval(id);
  }, [anyLfoActive]);

  const modded = useMemo(() => {
    let m = params;
    if (anyLfoActive) m = applyLfos(m, lfos, performance.now());
    if (motionConfig.targetPitch || motionConfig.targetRoll) m = applyMotion(m, motionConfig, motionPitch, motionRoll);
    return m;
  }, [params, lfos, lfoTick, anyLfoActive, motionConfig, motionPitch, motionRoll]);
  const auditioned = useMemo(() => (fxBypass ? bypassEffects(modded) : modded), [modded, fxBypass]);

  const audioEngine = useMemo(() => new AudioEngine(SYNTH_PRESETS[0].params), []);

  // The transformer needs live audio nodes, so it is built the first time the engine is
  // running and the module is switched on, and torn down with the page.
  useEffect(() => {
    if (!isEngineActive || !bufferParams.enabled) {
      bufferRef.current?.setParams({ ...bufferParams, enabled: false });
      return;
    }
    if (!bufferRef.current) {
      const ctx = audioEngine.context;
      const tap = audioEngine.analysisTap;
      const monitor = audioEngine.monitorBus;
      if (!ctx || !tap || !monitor) return;
      bufferRef.current = new BufferTransformer(ctx, tap, monitor);
    }
    bufferRef.current.setParams(bufferParams);
  }, [audioEngine, bufferParams, isEngineActive]);

  useEffect(() => () => bufferRef.current?.dispose(), []);

  // FLKey 37 control layer
  const midiRouter = useMemo(() => new MidiRouter(FLKEY37_DEFAULT_MAP()), []);
  const [midiDevice, setMidiDevice] = useState<string | null>(null);
  const [midiEnabled, setMidiEnabled] = useState(true);
  const [knobsEnabled, setKnobsEnabled] = useState(true);
  const [midiLearn, setMidiLearn] = useState(false);
  const [focusedKey, setFocusedKey] = useState<keyof SynthParams | null>(null);
  const [seqTransport, setSeqTransport] = useState<SeqTransport | null>(null);

  // Deci-core arithmetic patcher: sample the spectrum → run a base-10 Turing-machine
  // program on the Gödel-packed seed → re-program the synth from the result.
  const [deciEnabled, setDeciEnabled] = useState(false);
  const [deciProgram, setDeciProgram] = useState('113344');
  const [deciDepth, setDeciDepth] = useState(0.6);
  // 'number' is the primary mode: the program's integers become the waveform itself.
  // 'arith' / 'full' are the older knob-remapping modes, kept as options.
  const [deciScope, setDeciScope] = useState<DeciScope>('number');
  const [deciLearn, setDeciLearn] = useState(false);
  const [deciLast, setDeciLast] = useState<{
    seed: bigint;
    result: bigint;
    steps: number;
    halted: boolean;
  } | null>(null);

  // Dev-only handles for driving the engine / MIDI from the console / tests
  if (import.meta.env.DEV) {
    (window as any).__engine = audioEngine;
    (window as any).__midi = midiRouter;
  }

  // Web MIDI source → router (the JUCE/VST build feeds router.handleMessage instead)
  useEffect(() => {
    const disconnect = connectWebMidi(midiRouter, (names) =>
      setMidiDevice(names[0] || null)
    );
    return disconnect;
  }, [midiRouter]);

  useEffect(() => {
    midiRouter.enabled = midiEnabled;
    midiRouter.knobsEnabled = knobsEnabled;
  }, [midiRouter, midiEnabled, knobsEnabled]);

  // Scale a normalized 0..1 controller value into a parameter's range
  const setParamFromMidi = useCallback((key: keyof SynthParams, v01: number) => {
    const spec = PARAM_SPECS[key];
    if (!spec) return;
    const raw = spec.min + v01 * (spec.max - spec.min);
    const q = Math.min(
      spec.max,
      Math.max(spec.min, Math.round((raw - spec.min) / spec.step) * spec.step + spec.min)
    );
    setParams((prev) => ({ ...prev, [key]: Number(q.toFixed(6)) }));
    setEdited(true);
    setVfd({ label: spec.label, value: spec.format(q) });
  }, []);

  useEffect(() => {
    audioEngine.setParams(auditioned);
  }, [auditioned, audioEngine]);

  useEffect(() => {
    if (!looperRef.current) {
      looperRef.current = new Looper(audioEngine);
      looperRef.current.onStateChange = setLooperState;
    }
  }, [audioEngine]);

  useEffect(() => {
    if (motionEnabled) {
      startMotionDetection(
        () => {
          audioEngine.triggerKick();
          looperRef.current?.recordEvent('kick');
        },
        () => {
          audioEngine.triggerShaker();
          looperRef.current?.recordEvent('shaker');
        },
        () => {
          audioEngine.triggerCrash();
          looperRef.current?.recordEvent('crash');
        },
        (pitch, roll) => {
          setMotionPitch(pitch);
          setMotionRoll(roll);
        }
      );
    } else {
      stopMotionDetection();
    }
    return () => stopMotionDetection();
  }, [motionEnabled, audioEngine]);

  useEffect(() => {
    audioEngine.registerVoiceStateCallback(() => {
      setActiveNotes(audioEngine.getActiveNotes());
    });
  }, [audioEngine]);

  const handleStartEngine = useCallback(() => {
    audioEngine
      .start()
      .then(() => setIsEngineActive(true))
      .catch((err) => console.error('Failed to start audio engine:', err));
  }, [audioEngine]);

  const handleNoteOn = useCallback(
    (note: number, frequency: number) => {
      setLastPlayedNote(note);
      looperRef.current?.recordEvent('noteOn', note);
      audioEngine
        .start()
        .then(() => {
          setIsEngineActive(true);
          audioEngine.noteOn(note, frequency);
        })
        .catch((err) => console.error('Failed to start audio engine:', err));
    },
    [audioEngine]
  );

  const handleNoteOff = useCallback(
    (note: number) => {
      looperRef.current?.recordEvent('noteOff', note);
      audioEngine.noteOff(note);
    },
    [audioEngine]
  );

  const handlePanic = useCallback(() => {
    audioEngine.panic();
    panicBus.dispatchEvent(new Event('panic'));
  }, [audioEngine, panicBus]);

  const handleParamsChange = useCallback((next: SynthParams) => {
    setParams(next);
    setEdited(true);
  }, []);

  // CP¹ automorphism sequencer step → drive the Möbius Boost/Tilt params
  const handleStepParams = useCallback((p: { mobiusBoost: number; mobiusTilt: number }) => {
    setParams((prev) => ({ ...prev, mobiusBoost: p.mobiusBoost, mobiusTilt: p.mobiusTilt }));
    setEdited(true);
  }, []);

  // Knob-touch reporting doubles as LFO assignment (ASSIGN armed) or MIDI-learn (Learn on)
  const handleTouch = useCallback(
    (key: keyof SynthParams, label: string, value: string) => {
      if (midiLearn && PARAM_SPECS[key]) {
        midiRouter.armLearn({ kind: 'param', key });
        setFocusedKey(key);
        setVfd({ label: 'MIDI learn', value: `${PARAM_SPECS[key]!.label} → move ctrl` });
        return;
      }
      if (armed !== null && PARAM_SPECS[key]) {
        const slot = armed;
        setLfos((ls) =>
          ls.map((l, i) =>
            i === slot ? { ...l, target: key, depth: l.depth > 0.001 ? l.depth : 0.25 } : l
          )
        );
        setArmed(null);
        setVfd({ label: `LFO${slot + 1} →`, value: PARAM_SPECS[key]!.label });
        return;
      }
      setVfd({ label, value });
    },
    [armed, midiLearn, midiRouter]
  );

  const handleLfoChange = useCallback((index: number, next: LfoConfig) => {
    setLfos((ls) => ls.map((l, i) => (i === index ? next : l)));
  }, []);

  const handleLfoArm = useCallback((index: number) => {
    setArmed((prev) => {
      if (prev === index) {
        // Second click: disarm and clear the assignment
        setLfos((ls) => ls.map((l, i) => (i === index ? { ...l, target: null } : l)));
        setVfd({ label: `LFO${index + 1}`, value: 'cleared' });
        return null;
      }
      setVfd({ label: `LFO${index + 1} assign`, value: 'touch a knob…' });
      return index;
    });
  }, []);

  const handleLfoTouch = useCallback((label: string, value: string) => {
    setVfd({ label, value });
  }, []);

  // The combined patch list: every factory patch, then the 16 user memory slots. A slot
  // with nothing in it still occupies a position so it can be selected and stored into.
  const allPatches = useMemo(() => {
    const users = userSlots.map((slot, i) => ({
      id: `user-${i}`,
      name: slot ? slot.name : `Slot ${String(i + 1).padStart(2, '0')} — empty`,
      description: slot ? 'User memory slot' : 'Empty user memory slot',
      params: slot ? slot.params : SYNTH_PRESETS[0].params,
      bank: USER_BANK,
      empty: !slot,
    }));
    return [
      ...SYNTH_PRESETS.map((preset) => ({ ...preset, empty: false })),
      ...users,
    ];
  }, [userSlots]);

  const banks = useMemo(() => [...FACTORY_BANKS, USER_BANK], []);
  /** Indices of the patches in a given bank, in list order. */
  const bankIndices = useCallback(
    (name: string) => allPatches.map((x, i) => (x.bank === name ? i : -1)).filter((i) => i >= 0),
    [allPatches]
  );

  const selectPatch = useCallback(
    (index: number) => {
      const list = allPatches;
      const i = ((index % list.length) + list.length) % list.length;
      const target = list[i];
      setPatchIndex(i);
      if (target.bank) setBank(target.bank);
      setVfd(null);
      // Landing on an empty slot moves the cursor without touching the sound — that is the
      // Store workflow: dial something in, walk to a free slot, write it there.
      if (target.empty) {
        setEdited(true);
        return;
      }
      setEdited(false);
      setParams({ ...target.params });
    },
    [allPatches]
  );

  /** Step within the current bank, wrapping there rather than spilling into the next one. */
  const stepPatch = useCallback(
    (delta: number) => {
      const indices = bankIndices(bank);
      if (!indices.length) return;
      const at = indices.indexOf(patchIndex);
      const next = at < 0 ? 0 : (((at + delta) % indices.length) + indices.length) % indices.length;
      selectPatch(indices[next]);
    },
    [bank, bankIndices, patchIndex, selectPatch]
  );

  const selectBank = useCallback(
    (name: string) => {
      setBank(name);
      const indices = bankIndices(name);
      if (indices.length && !indices.includes(patchIndex)) selectPatch(indices[0]);
    },
    [bankIndices, patchIndex, selectPatch]
  );

  const commitSlots = useCallback((next: (UserSlot | null)[]) => {
    setUserSlots(next);
    if (!saveUserSlots(next)) {
      setVfd({ label: 'Memory', value: 'storage unavailable — session only' });
    }
  }, []);

  /** Write the current sound into a memory slot: this one if we are on one, else the first free. */
  const storePatch = useCallback(() => {
    const userStart = SYNTH_PRESETS.length;
    const onSlot = patchIndex >= userStart;
    const slotIndex = onSlot ? patchIndex - userStart : firstEmptySlot(userSlots);
    if (slotIndex < 0) {
      setVfd({ label: 'Memory', value: `all ${USER_SLOT_COUNT} slots full — clear one` });
      return;
    }
    const existing = userSlots[slotIndex];
    const sourceName = allPatches[patchIndex]?.name ?? 'Patch';
    const next = [...userSlots];
    next[slotIndex] = {
      name: existing ? existing.name : slotNameFor(sourceName, slotIndex),
      params: { ...params },
      savedAt: Date.now(),
    };
    commitSlots(next);
    setPatchIndex(userStart + slotIndex);
    setBank(USER_BANK);
    setEdited(false);
    setVfd({ label: 'Stored', value: `slot ${String(slotIndex + 1).padStart(2, '0')}` });
  }, [allPatches, commitSlots, params, patchIndex, userSlots]);

  const renameSlot = useCallback(
    (name: string) => {
      const slotIndex = patchIndex - SYNTH_PRESETS.length;
      if (slotIndex < 0 || !userSlots[slotIndex]) return;
      const next = [...userSlots];
      next[slotIndex] = { ...userSlots[slotIndex]!, name };
      commitSlots(next);
    },
    [commitSlots, patchIndex, userSlots]
  );

  const clearSlot = useCallback(() => {
    const slotIndex = patchIndex - SYNTH_PRESETS.length;
    if (slotIndex < 0 || !userSlots[slotIndex]) return;
    const next = [...userSlots];
    next[slotIndex] = null;
    commitSlots(next);
    setEdited(true);
    setVfd({ label: 'Cleared', value: `slot ${String(slotIndex + 1).padStart(2, '0')}` });
  }, [commitSlots, patchIndex, userSlots]);

  // The handlers need the current params/focus/patch, but the router connection is
  // stable. Rather than re-binding the handler object every render (which fired 60×/s
  // during LFO ticks), we bind once and read the mutable bits through a ref that stays
  // current. All the callbacks below are memoized, so the effect only re-runs if the
  // router itself is swapped.
  const latest = useRef({
    params,
    focusedKey,
    patchIndex,
    deciEnabled,
    deciProgram,
    deciDepth,
    deciScope,
    stepPatch,
  });
  latest.current = {
    params,
    focusedKey,
    patchIndex,
    deciEnabled,
    deciProgram,
    deciDepth,
    deciScope,
    stepPatch,
  };

  // Sample the live spectrum, run the deci-core program on the Gödel-packed seed, and
  // re-program the synth from the result. Reads the mutable bits through `latest` so it
  // stays a stable callback (the MIDI trigger binds it once).
  const runDeciGenerate = useCallback(() => {
    const { params, deciProgram, deciDepth, deciScope } = latest.current;
    const freq = audioEngine.getFrequencyData();

    if (deciScope === 'number') {
      // Number mode: the machine's integers become the arithmetic oscillator's curve, and
      // with a sequence set the note walks its trajectory from seed to result.
      const { params: next, seed, result, steps, halted, trajectory } = generateNumberPatch(
        params,
        freq,
        deciProgram,
        { depth: deciDepth }
      );
      setParams(next);
      setEdited(true);
      setDeciLast({ seed, result, steps, halted });
      setVfd({
        label: 'Deci-Core',
        value:
          trajectory.length > 1
            ? `${steps} steps → ${trajectory.length}-pt curve`
            : `${steps} steps → curve`,
      });
      return;
    }

    const map = deciScope === 'full' ? FULL_DECI_MAP : DEFAULT_DECI_MAP;
    const { params: next, seed, result, steps, halted } = generatePatch(
      params,
      freq,
      deciProgram,
      { map, depth: deciDepth }
    );
    setParams(next);
    setEdited(true);
    setDeciLast({ seed, result, steps, halted });
    setVfd({ label: 'Deci-Core', value: `${steps} steps → patched` });
  }, [audioEngine]);

  useEffect(() => {
    const stepFocus = (dir: number) => {
      const { focusedKey, params } = latest.current;
      const i = focusedKey ? NAV_ORDER.indexOf(focusedKey) : -1;
      const key = NAV_ORDER[(i + dir + NAV_ORDER.length) % NAV_ORDER.length];
      setFocusedKey(key);
      const spec = PARAM_SPECS[key];
      if (spec) setVfd({ label: `▸ ${spec.label}`, value: spec.format(params[key] as number) });
    };
    midiRouter.handlers = {
      onNoteOn: (n) => handleNoteOn(n, midiToFreq(n)),
      onNoteOff: (n) => handleNoteOff(n),
      onParam: setParamFromMidi,
      onPitchBend: (s) => audioEngine.setPitchBend(s),
      onPresetPrev: () => latest.current.stepPatch(-1),
      onPresetNext: () => latest.current.stepPatch(1),
      onFieldPrev: () => stepFocus(-1),
      onFieldNext: () => stepFocus(1),
      onFieldValue: (v) => {
        const { focusedKey } = latest.current;
        if (focusedKey) setParamFromMidi(focusedKey, v);
      },
      onSeqRun: () => setSeqTransport({ cmd: 'run', id: Date.now() }),
      onSeqStop: () => setSeqTransport({ cmd: 'stop', id: Date.now() }),
      onDeciTrigger: () => {
        if (latest.current.deciEnabled) runDeciGenerate();
      },
      onLearn: (t, cc) => {
        setMidiLearn(false);
        setDeciLearn(false);
        setVfd({
          label: t.kind === 'deciTrigger' ? 'Deci bound' : 'MIDI bound',
          value: `CC ${cc}`,
        });
      },
    };
  }, [
    midiRouter,
    handleNoteOn,
    handleNoteOff,
    setParamFromMidi,
    audioEngine,
    selectPatch,
    runDeciGenerate,
  ]);

  const patch = allPatches[patchIndex] ?? allPatches[0];
  const userSlotIndex = patchIndex - SYNTH_PRESETS.length;
  const currentSlot = userSlotIndex >= 0 ? userSlots[userSlotIndex] : null;
  const bankEntries: PatchEntry[] = bankIndices(bank).map((i) => ({
    index: i,
    label: allPatches[i].name,
    empty: allPatches[i].empty,
  }));
  const bankPosition = bankIndices(bank).indexOf(patchIndex) + 1;

  return (
    <div className="min-h-screen flex md:items-center justify-center md:p-4 overflow-auto bg-black md:bg-transparent">
      <div className="flex w-full md:w-[1100px] md:rounded-lg shadow-[0_18px_50px_rgba(0,0,0,0.7)] shrink-0">
        {/* Wood cheeks */}
        <div className="wood w-6 rounded-l-lg shrink-0 hidden md:block" />

        {/* Faceplate */}
        <div className="bg-face flex-1 min-w-0 md:border-y border-black px-2 md:px-5 py-3 flex flex-col gap-2 min-h-screen md:min-h-0 md:h-[760px]">
          {/* Brand row */}
          <div className="flex items-end justify-between pb-1.5 border-b border-silk/20">
            <div className="flex items-baseline gap-3">
              <span className="text-[15px] font-bold tracking-[0.28em] text-label uppercase">
                Phase<span className="vfd-text"> Projection</span>
              </span>
              <span className="text-[8px] tracking-[0.2em] uppercase text-dim">
                Projective Fourier Instruments
              </span>
            </div>
            <span className="text-[8px] tracking-[0.18em] uppercase text-silk/70 border border-silk/30 rounded-sm px-2 py-0.5">
              Synthesizer Model PP-512 · Additive Resynthesis Engine
            </span>
          </div>

          {/* Page tabs + transport (always visible) */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1.5">
              {MAIN_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setMainTab(t.id)}
                  className={`px-3 py-1 rounded-[3px] border text-[9px] uppercase tracking-[0.18em] cursor-pointer transition-colors ${
                    mainTab === t.id
                      ? 'border-phos/60 text-phos bg-phos/10'
                      : 'border-silk/20 text-dim hover:text-label'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2.5">
              <HardwareButton
                label="A/B"
                lit={fxBypass}
                onClick={() => {
                  setFxBypass((v) => {
                    const next = !v;
                    setVfd({ label: 'FX audition', value: next ? 'B · bypass' : 'A · processed' });
                    return next;
                  });
                }}
                title="Toggle between the processed patch (A) and a neutralized-effects reference (B)"
              />
              <HardwareButton
                label="Power"
                lit={isEngineActive}
                onClick={handleStartEngine}
                title="Start the audio engine"
              />
              <HardwareButton
                label="Panic"
                lit={activeNotes.length > 0}
                color="red"
                onClick={handlePanic}
                title="Silence all voices"
              />
            </div>
          </div>

          {/* VFD strip — patch + bank selection, memory slots, and parameter feedback */}
          <PatchStrip
            banks={banks}
            bank={bank}
            onBankChange={selectBank}
            entries={bankEntries}
            patchIndex={patchIndex}
            onSelect={selectPatch}
            onStep={stepPatch}
            patchName={patch.name}
            patchNumber={bankPosition > 0 ? bankPosition : 1}
            edited={edited}
            statusLine={
              vfd
                ? `${vfd.label}: ${vfd.value}`
                : `${bank} · poly ${activeNotes.length} · ${isEngineActive ? 'engine run' : 'standby'}`
            }
            isUserBank={bank === USER_BANK}
            slotOccupied={!!currentSlot}
            slotName={currentSlot?.name ?? ''}
            onSlotNameChange={renameSlot}
            onStore={storePatch}
            onClear={clearSlot}
            storeHint={
              userSlotIndex >= 0
                ? `Write the current sound into memory slot ${String(userSlotIndex + 1).padStart(2, '0')}`
                : 'Write the current sound into the first free memory slot'
            }
          />

          {/* Page content — scrolls internally so the outer frame stays a fixed size.
              Both pages stay mounted (toggled with `hidden`) so the keyboard's window
              key listeners and the sequencer keep running from either page. */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            {/* Editor page — the display with the controls that shape it nested beneath */}
            <div className={mainTab === 'editor' ? 'flex flex-col gap-2' : 'hidden'}>
              {/* Display window follows the modulated parameters */}
              <Display
                params={auditioned}
                mode={displayMode}
                isPlaying={activeNotes.length > 0}
                referenceNote={activeNotes[activeNotes.length - 1] ?? lastPlayedNote}
                bypassed={fxBypass}
              />

              {/* Display-visual selector */}
              <div className="flex gap-1">
                {DISPLAY_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setDisplayMode(m.id)}
                    className={`px-2 py-1 rounded-[2px] border text-[8px] uppercase tracking-wider cursor-pointer transition-colors ${
                      displayMode === m.id
                        ? 'border-phos/50 text-phos'
                        : 'border-silk/20 text-dim hover:text-label'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Nested controls — the parameters that shape the active visual sit
                  directly beneath it, so knob tweaks are seen live in the display above */}
              <MemoControls
                params={params}
                onChange={handleParamsChange}
                onTouch={handleTouch}
                focusedKey={focusedKey}
                visual={displayMode}
                section="visual"
              />
            </div>

            {/* Perform page — compacted control panels above the keyboard */}
            <div className={mainTab === 'perform' ? 'flex flex-col gap-1.5' : 'hidden'}>
              <MemoControls
                params={params}
                onChange={handleParamsChange}
                onTouch={handleTouch}
                focusedKey={focusedKey}
                visual={displayMode}
                section="output"
                compact
              />

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                {/* Modulation deck */}
                <LfoPanel
                  lfos={lfos}
                  armed={armed}
                  onChange={handleLfoChange}
                  onArm={handleLfoArm}
                  onTouch={handleLfoTouch}
                />

                <div className="flex flex-col gap-2 p-3 bg-black/40 border border-silk/20 rounded-sm">
                  <div className="text-[10px] uppercase tracking-widest text-silk/60 flex justify-between items-center">
                    <span>Motion & Percussion</span>
                  </div>
                  <button
                    className={`py-2 text-xs font-bold rounded-sm transition-colors ${
                      motionEnabled
                        ? 'bg-amber-500/80 text-white shadow-[0_0_15px_rgba(245,158,11,0.5)]'
                        : 'bg-silk/10 text-silk hover:bg-silk/20'
                    }`}
                    onClick={() => {
                      if (!isEngineActive && !motionEnabled) {
                        audioEngine.start().then(() => setIsEngineActive(true));
                      }
                      setMotionEnabled((v) => !v);
                    }}
                  >
                    {motionEnabled ? 'MOTION ACTIVE' : 'ENABLE MOTION'}
                  </button>
                  <div className="text-[9px] text-silk/50">
                    Strike for Kick, Shake for Shaker, Whip for Crash
                  </div>
                  
                  <div className="flex gap-2 text-xs mt-1">
                    <div className="flex-1">
                      <label className="text-[9px] text-silk/50 block uppercase mb-1">Tilt Y Map (Pitch)</label>
                      <select 
                        className="w-full p-1 bg-black/50 border border-silk/20 text-silk rounded-sm outline-none"
                        value={motionConfig.targetPitch || ''}
                        onChange={e => setMotionConfig(c => ({ ...c, targetPitch: (e.target.value || null) as any }))}
                      >
                        <option value="">Off</option>
                        {Object.entries(PARAM_SPECS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-[9px] text-silk/50 block uppercase mb-1">Tilt X Map (Roll)</label>
                      <select 
                        className="w-full p-1 bg-black/50 border border-silk/20 text-silk rounded-sm outline-none"
                        value={motionConfig.targetRoll || ''}
                        onChange={e => setMotionConfig(c => ({ ...c, targetRoll: (e.target.value || null) as any }))}
                      >
                        <option value="">Off</option>
                        {Object.entries(PARAM_SPECS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <LooperPanel looper={looperRef.current} looperState={looperState} />

                {/* FLKey 37 control layer */}
                <MidiPanel
                  deviceName={midiDevice}
                  enabled={midiEnabled}
                  knobsEnabled={knobsEnabled}
                  learnActive={midiLearn}
                  onToggleEnabled={() => setMidiEnabled((v) => !v)}
                  onToggleKnobs={() => setKnobsEnabled((v) => !v)}
                  onToggleLearn={() => {
                    setMidiLearn((v) => {
                      const next = !v;
                      if (!next) midiRouter.armLearn(null);
                      setVfd({ label: 'MIDI learn', value: next ? 'touch a knob…' : 'off' });
                      return next;
                    });
                  }}
                />
              </div>

              {/* Deci-core arithmetic patcher */}
              <BufferPanel
                params={bufferParams}
                onChange={setBufferParams}
                active={isEngineActive}
              />

              <DeciPanel
                enabled={deciEnabled}
                program={deciProgram}
                depth={deciDepth}
                scope={deciScope}
                learnActive={deciLearn}
                last={deciLast}
                onToggleEnabled={() => setDeciEnabled((v) => !v)}
                onProgramChange={setDeciProgram}
                onDepthChange={setDeciDepth}
                onScopeChange={setDeciScope}
                onGenerate={runDeciGenerate}
                onToggleLearn={() =>
                  setDeciLearn((v) => {
                    const next = !v;
                    if (next) {
                      midiRouter.armLearn({ kind: 'deciTrigger' });
                      setMidiLearn(false);
                      setVfd({ label: 'Deci learn', value: 'press a pad/key…' });
                    } else {
                      midiRouter.armLearn(null);
                      setVfd({ label: 'Deci learn', value: 'off' });
                    }
                    return next;
                  })
                }
              />

              {/* Sequencer + keyboard */}
              <MemoKeyboard
                onNoteOn={handleNoteOn}
                onNoteOff={handleNoteOff}
                activeNotes={activeNotes}
                panicBus={panicBus}
                transport={seqTransport}
                onStepParams={handleStepParams}
              />
            </div>
          </div>

          {/* Baseplate line */}
          <div className="flex justify-between pt-1 border-t border-silk/15 text-[7px] tracking-[0.2em] uppercase text-dim">
            <span>web audio · worklet additive bank · dft resynthesis</span>
            <span>qwerty a–&#39; plays · shift+drag = fine · double-click = reset</span>
          </div>
        </div>

        <div className="wood-r w-6 rounded-r-lg shrink-0 hidden md:block" />
      </div>
    </div>
  );
}
