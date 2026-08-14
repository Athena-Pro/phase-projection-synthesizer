import React, { useState, useEffect, useRef } from 'react';
import { midiToFreq } from '../lib/audioEngine';
import { Knob, HardwareButton, HardwareSection, SegmentGroup } from './ui';
import { haptics } from '../lib/haptics';

interface VirtualKeyboardProps {
  onNoteOn: (note: number, frequency: number) => void;
  onNoteOff: (note: number) => void;
  activeNotes: number[];
  /** Panic signal from the parent; emits a 'panic' event to silence held notes. */
  panicBus?: EventTarget;
  /** Sequencer transport driven by the controller's Play/Stop keys. */
  transport?: { cmd: 'run' | 'stop'; id: number } | null;
  /** Per-step CP¹ automorphism: each sequencer step sets these Möbius params. */
  onStepParams?: (p: { mobiusBoost: number; mobiusTilt: number }) => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const KEY_TO_NOTE_OFFSET: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17,
};

const NOTE_OFFSET_TO_KEY: Record<number, string> = {
  0: 'A', 1: 'W', 2: 'S', 3: 'E', 4: 'D', 5: 'F', 6: 'T', 7: 'G', 8: 'Y',
  9: 'H', 10: 'U', 11: 'J', 12: 'K', 13: 'O', 14: 'L', 15: 'P', 16: ';', 17: "'",
};

export default function VirtualKeyboard({
  onNoteOn,
  onNoteOff,
  activeNotes,
  panicBus,
  transport,
  onStepParams,
}: VirtualKeyboardProps) {
  const [octaveOffset, setOctaveOffset] = useState<number>(0);

  const [isSequencing, setIsSequencing] = useState(false);
  const [tempo, setTempo] = useState(110);
  const [sequence, setSequence] = useState<number[]>([48, 55, 60, 63, 65, 67, 70, 72]);
  const [seqActiveStep, setSeqActiveStep] = useState<number>(-1);

  // CP¹ automorphism lane: each step drives Möbius Boost/Tilt for rhythmic phase orbits
  const [cp1Seq, setCp1Seq] = useState(false);
  const [seqBoost, setSeqBoost] = useState<number[]>(() => [0, 0.5, -0.5, 0.5, -1, 0.5, -0.5, 1]);
  const [seqTilt, setSeqTilt] = useState<number[]>(() => [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);

  // The sequencer reads the pattern through a ref so editing steps never restarts
  // the interval, and remembers the exact note it played so the matching note-off
  // can never miss.
  const sequenceRef = useRef(sequence);
  const prevSeqNoteRef = useRef<number | null>(null);
  const pressedKeysMapRef = useRef<Map<string, number>>(new Map());
  const activeScreenNotesRef = useRef<Map<number, number>>(new Map());
  const lastTransportId = useRef<number | null>(null);
  const cp1SeqRef = useRef(cp1Seq);
  const seqBoostRef = useRef(seqBoost);
  const seqTiltRef = useRef(seqTilt);
  const onStepParamsRef = useRef(onStepParams);

  useEffect(() => {
    sequenceRef.current = sequence;
  }, [sequence]);
  useEffect(() => {
    cp1SeqRef.current = cp1Seq;
    seqBoostRef.current = seqBoost;
    seqTiltRef.current = seqTilt;
    onStepParamsRef.current = onStepParams;
  }, [cp1Seq, seqBoost, seqTilt, onStepParams]);

  // Play/Stop from the FLKey transport keys — Run restarts the pattern at step 0
  useEffect(() => {
    if (!transport || transport.id === lastTransportId.current) return;
    lastTransportId.current = transport.id;
    setIsSequencing(transport.cmd === 'run');
  }, [transport]);

  const baseStartNote = 48; // C3
  const numKeys = 25;

  const keys = Array.from({ length: numKeys }, (_, i) => {
    const midiNote = baseStartNote + i;
    const noteInOctave = midiNote % 12;
    const name = NOTE_NAMES[noteInOctave] + Math.floor(midiNote / 12);
    const isBlack = [1, 3, 6, 8, 10].includes(noteInOctave);
    return { midiNote, noteInOctave, name, isBlack };
  });

  const whiteKeys = keys.filter((k) => !k.isBlack);

  const getShiftedNote = (midiNote: number) => midiNote + octaveOffset * 12;

  const handleKeyOn = (midiNote: number) => {
    const existing = activeScreenNotesRef.current.get(midiNote);
    if (existing !== undefined) {
      onNoteOff(existing);
    }
    const shifted = getShiftedNote(midiNote);
    activeScreenNotesRef.current.set(midiNote, shifted);
    haptics.impactLight();
    onNoteOn(shifted, midiToFreq(shifted));
  };

  const handleKeyOff = (midiNote: number) => {
    const shifted = activeScreenNotesRef.current.get(midiNote);
    if (shifted !== undefined) {
      onNoteOff(shifted);
      activeScreenNotesRef.current.delete(midiNote);
    } else {
      onNoteOff(getShiftedNote(midiNote));
    }
  };

  // Panic from the parent silences the sequencer and any held notes
  useEffect(() => {
    if (!panicBus) return;
    const onPanic = () => {
      setIsSequencing(false);
      setSeqActiveStep(-1);

      if (prevSeqNoteRef.current !== null) {
        onNoteOff(prevSeqNoteRef.current);
        prevSeqNoteRef.current = null;
      }

      pressedKeysMapRef.current.forEach((shiftedNote) => onNoteOff(shiftedNote));
      pressedKeysMapRef.current.clear();

      activeScreenNotesRef.current.forEach((shiftedNote) => onNoteOff(shiftedNote));
      activeScreenNotesRef.current.clear();
    };
    panicBus.addEventListener('panic', onPanic);
    return () => panicBus.removeEventListener('panic', onPanic);
  }, [panicBus, onNoteOff]);

  // QWERTY + pointer release listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'SELECT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('role') === 'slider' ||
        e.ctrlKey || e.metaKey || e.altKey
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (KEY_TO_NOTE_OFFSET[key] !== undefined && !pressedKeysMapRef.current.has(key)) {
        const midiNote = baseStartNote + KEY_TO_NOTE_OFFSET[key];
        const shifted = getShiftedNote(midiNote);
        pressedKeysMapRef.current.set(key, shifted);
        onNoteOn(shifted, midiToFreq(shifted));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const playingShiftedNote = pressedKeysMapRef.current.get(key);
      if (playingShiftedNote !== undefined) {
        onNoteOff(playingShiftedNote);
        pressedKeysMapRef.current.delete(key);
      }
    };

    const releaseAll = () => {
      pressedKeysMapRef.current.forEach((shiftedNote) => onNoteOff(shiftedNote));
      pressedKeysMapRef.current.clear();
      activeScreenNotesRef.current.forEach((shiftedNote) => onNoteOff(shiftedNote));
      activeScreenNotesRef.current.clear();
    };

    const handleWindowMouseUp = () => {
      activeScreenNotesRef.current.forEach((shiftedNote) => onNoteOff(shiftedNote));
      activeScreenNotesRef.current.clear();
    };

    const handleWindowTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) handleWindowMouseUp();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('touchend', handleWindowTouchEnd);
    window.addEventListener('touchcancel', handleWindowTouchEnd);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('touchend', handleWindowTouchEnd);
      window.removeEventListener('touchcancel', handleWindowTouchEnd);
    };
  }, [octaveOffset, onNoteOn, onNoteOff]);

  // Sequencer loop — restarts only when transport state or tempo changes
  useEffect(() => {
    if (!isSequencing) {
      if (prevSeqNoteRef.current !== null) {
        onNoteOff(prevSeqNoteRef.current);
        prevSeqNoteRef.current = null;
      }
      setSeqActiveStep(-1);
      return;
    }

    const stepIntervalMs = (60 / tempo / 2) * 1000; // eighth notes
    let currentStep = 0;

    const tick = () => {
      if (prevSeqNoteRef.current !== null) {
        onNoteOff(prevSeqNoteRef.current);
      }

      const seq = sequenceRef.current;
      const step = currentStep % seq.length;
      const note = seq[step];
      onNoteOn(note, midiToFreq(note));
      prevSeqNoteRef.current = note;
      setSeqActiveStep(step);

      // CP¹ automorphism: step the Möbius Boost/Tilt so the phase orbit moves in rhythm
      if (cp1SeqRef.current && onStepParamsRef.current) {
        onStepParamsRef.current({
          mobiusBoost: seqBoostRef.current[step] ?? 0,
          mobiusTilt: seqTiltRef.current[step] ?? 0,
        });
      }

      currentStep = (step + 1) % seq.length;
    };

    tick();
    const timer = setInterval(tick, stepIntervalMs);

    return () => {
      clearInterval(timer);
      if (prevSeqNoteRef.current !== null) {
        onNoteOff(prevSeqNoteRef.current);
        prevSeqNoteRef.current = null;
      }
    };
  }, [isSequencing, tempo, onNoteOn, onNoteOff]);

  const handleStepValueChange = (index: number, value: number) => {
    setSequence((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const setLaneValue = (
    setter: React.Dispatch<React.SetStateAction<number[]>>,
    index: number,
    value: number
  ) => setter((prev) => prev.map((v, i) => (i === index ? value : v)));

  // Discrete Möbius values per step (Boost/Tilt both span −1..1)
  const AUTO_VALS = [-1, -0.5, 0, 0.5, 1];
  const autoLabel = (v: number) => (v === 0 ? '0' : v > 0 ? `+${v}` : `${v}`);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-2">
      {/* Sequencer strip */}
      <HardwareSection title="Sequencer">
        <div className="flex items-start gap-3">
          <div className="flex items-start gap-2">
            <HardwareButton
              label="Run"
              lit={isSequencing}
              onClick={() => setIsSequencing(true)}
            />
            <HardwareButton
              label="Stop"
              lit={false}
              onClick={() => setIsSequencing(false)}
            />
            <HardwareButton
              label="CP¹"
              lit={cp1Seq}
              onClick={() => setCp1Seq((v) => !v)}
              title="CP¹ automorphism lane — each step sets Möbius Boost/Tilt for rhythmic phase orbits"
            />
            <Knob
              label="Tempo"
              value={tempo}
              min={50}
              max={220}
              step={1}
              format={(v) => `${v} bpm`}
              defaultValue={110}
              onChange={setTempo}
            />
          </div>

          <div className="flex gap-1">
            {sequence.map((note, index) => {
              const isActive = seqActiveStep === index;
              return (
                <div key={index} className="flex flex-col items-center gap-1">
                  <span className={`w-5 h-5 rounded-[3px] border ${
                    isActive
                      ? 'led-on border-phos/70'
                      : 'bg-face2 border-silk/25'
                  }`} />
                  <select
                    value={note}
                    onChange={(e) => handleStepValueChange(index, Number(e.target.value))}
                    className="w-11 bg-well border border-silk/20 rounded-[2px] px-0.5 py-0.5 text-[9px] text-label focus:outline-none focus:border-phos/60 cursor-pointer"
                  >
                    {Array.from({ length: 25 }, (_, i) => {
                      const m = 48 + i;
                      const name = NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
                      return (
                        <option key={m} value={m}>
                          {name}
                        </option>
                      );
                    })}
                  </select>
                  {cp1Seq && (
                    <>
                      <select
                        value={seqBoost[index] ?? 0}
                        onChange={(e) => setLaneValue(setSeqBoost, index, Number(e.target.value))}
                        title="Möbius Boost at this step"
                        className="w-11 bg-well border border-phos/25 rounded-[2px] px-0.5 py-0.5 text-[8px] text-phos/90 focus:outline-none focus:border-phos/60 cursor-pointer"
                      >
                        {AUTO_VALS.map((v) => (
                          <option key={v} value={v}>{`B ${autoLabel(v)}`}</option>
                        ))}
                      </select>
                      <select
                        value={seqTilt[index] ?? 0}
                        onChange={(e) => setLaneValue(setSeqTilt, index, Number(e.target.value))}
                        title="Möbius Tilt at this step"
                        className="w-11 bg-well border border-amber-500/25 rounded-[2px] px-0.5 py-0.5 text-[8px] text-amber-300/90 focus:outline-none focus:border-amber-400/60 cursor-pointer"
                      >
                        {AUTO_VALS.map((v) => (
                          <option key={v} value={v}>{`T ${autoLabel(v)}`}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </HardwareSection>

      {/* Keyboard strip */}
      <HardwareSection title="Keyboard">
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1 shrink-0">
            <SegmentGroup<number>
              value={octaveOffset}
              onChange={(o) => setOctaveOffset(o)}
              options={[-2, -1, 0, 1, 2].map((o) => ({
                id: o,
                label: o > 0 ? `+${o}` : `${o}`,
              }))}
            />
          </div>

          <div className="flex-1 overflow-x-auto select-none">
            <div className="relative min-w-[560px]">
              <div className="flex w-full">
                {whiteKeys.map((k) => {
                  const isNoteActive =
                    activeNotes.some(
                      (n) => n === getShiftedNote(k.midiNote) || n === k.midiNote
                    ) ||
                    (seqActiveStep !== -1 && sequence[seqActiveStep] === k.midiNote);
                  const keyLabel = NOTE_OFFSET_TO_KEY[k.midiNote - baseStartNote];
                  return (
                    <div
                      key={k.midiNote}
                      onMouseDown={() => handleKeyOn(k.midiNote)}
                      onMouseUp={() => handleKeyOff(k.midiNote)}
                      onMouseLeave={() => handleKeyOff(k.midiNote)}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        handleKeyOn(k.midiNote);
                      }}
                      onTouchEnd={() => handleKeyOff(k.midiNote)}
                      onTouchCancel={() => handleKeyOff(k.midiNote)}
                      className={`flex-1 min-w-[32px] h-32 border border-black/60 rounded-b-[3px] flex flex-col justify-end items-center pb-1 transition-colors cursor-pointer ${
                        isNoteActive
                          ? 'bg-phos text-black'
                          : 'bg-[#e8e6dd] hover:bg-[#d6d4ca] text-black/50'
                      }`}
                    >
                      <span className="text-[7px] font-bold">{keyLabel || ''}</span>
                    </div>
                  );
                })}
              </div>

              <div className="absolute top-0 left-0 right-0 h-12 pointer-events-none flex">
                {whiteKeys.map((wk, idx) => {
                  const hasBlackRight =
                    [0, 2, 5, 7, 9].includes(wk.noteInOctave) && idx < whiteKeys.length - 1;

                  if (!hasBlackRight)
                    return <div key={`sp-${wk.midiNote}`} className="flex-1 min-w-[26px]" />;

                  const blackNoteMidi = wk.midiNote + 1;
                  const isNoteActive =
                    activeNotes.some(
                      (n) => n === getShiftedNote(blackNoteMidi) || n === blackNoteMidi
                    ) ||
                    (seqActiveStep !== -1 && sequence[seqActiveStep] === blackNoteMidi);
                  const keyLabel = NOTE_OFFSET_TO_KEY[blackNoteMidi - baseStartNote];

                  return (
                    <div key={`bk-${wk.midiNote}`} className="flex-1 min-w-[26px] relative">
                      <div
                        onMouseDown={() => handleKeyOn(blackNoteMidi)}
                        onMouseUp={() => handleKeyOff(blackNoteMidi)}
                        onMouseLeave={() => handleKeyOff(blackNoteMidi)}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          handleKeyOn(blackNoteMidi);
                        }}
                        onTouchEnd={() => handleKeyOff(blackNoteMidi)}
                        onTouchCancel={() => handleKeyOff(blackNoteMidi)}
                        title={`${NOTE_NAMES[blackNoteMidi % 12]} (${keyLabel || ''})`}
                        className={`absolute left-1/2 -translate-x-1/2 w-[22px] h-20 rounded-b-[2px] z-10 cursor-pointer pointer-events-auto border border-black transition-colors ${
                          isNoteActive ? 'bg-phos' : 'bg-[#17181b] hover:bg-[#26282c]'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </HardwareSection>
    </div>
  );
}
