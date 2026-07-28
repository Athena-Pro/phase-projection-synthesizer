import React from 'react';
import { HardwareSection, HardwareButton } from './ui';

/** A couple of ready-made deci-core programs to seed the input. */
export const DECI_PROGRAMS: { code: string; name: string }[] = [
  { code: '3', name: 'Double' },
  { code: '113344', name: 'Gödel 3,2' },
  { code: '5041', name: 'Collatz step' },
  { code: '8719', name: 'Mirror loop' },
  { code: '133333333', name: 'Build 2⁸' },
  { code: '11111829', name: 'Up then down' },
];

interface DeciReadout {
  seed: bigint;
  result: bigint;
  steps: number;
  halted: boolean;
}

/**
 * What a Generate does with the program's output.
 *   • `number` — the primary mode: the integers *become the waveform*, written into the
 *     arithmetic oscillator's number sequence. Nothing else in the patch is touched.
 *   • `arith` / `full` — the original knob-remapping modes, kept as options: scatter the
 *     result across the number-theory parameters, or those plus timbre and space.
 */
export type DeciScope = 'number' | 'arith' | 'full';

const SCOPE_OPTIONS: { id: DeciScope; label: string; hint: string }[] = [
  {
    id: 'number',
    label: 'Num',
    hint: "Number mode: the program's integer becomes the arithmetic oscillator's curve — the sound you sampled, read back as a waveform. With a sequence set, the note walks from the seed to the result. Leaves every other parameter alone.",
  },
  {
    id: 'arith',
    label: 'Arith',
    hint: 'Knob mode: scatter the result across the number-theory parameters (comb, p-adic, Dirichlet, Hecke, Möbius)',
  },
  {
    id: 'full',
    label: 'Full',
    hint: 'Knob mode: the number-theory parameters plus timbre and spatial ones — the widest re-programming',
  },
];

interface DeciPanelProps {
  enabled: boolean;
  program: string;
  depth: number;
  scope: DeciScope;
  learnActive: boolean;
  last: DeciReadout | null;
  onToggleEnabled: () => void;
  onProgramChange: (code: string) => void;
  onDepthChange: (depth: number) => void;
  onScopeChange: (scope: DeciScope) => void;
  onGenerate: () => void;
  onToggleLearn: () => void;
}

/** Small toggle styled like the faceplate's other switches. */
function Toggle({
  label,
  on,
  onClick,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex flex-col items-center gap-1 cursor-pointer group select-none"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'led-on' : 'led-off'}`} />
      <span
        className={`px-1.5 h-5 rounded-[3px] border flex items-center text-[8px] uppercase tracking-wider transition-colors ${
          on
            ? 'bg-phos/15 border-phos/50 text-phos'
            : 'bg-face2 border-silk/25 text-dim group-hover:border-silk/50'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

/** Truncate a possibly-huge BigInt for the readout line. */
function fmtBig(n: bigint): string {
  const s = n.toString();
  return s.length > 12 ? s.slice(0, 10) + '…' : s;
}

/**
 * Deci-Core panel — samples the live spectrum into a Gödel-packed seed, runs a
 * base-10 Turing-machine program on it, and re-programs the synth from the result.
 * Modular and toggleable (like the MIDI layer); the Generate action is also
 * MIDI-learnable so an FLKey pad/CC can fire it.
 */
export default function DeciPanel({
  enabled,
  program,
  depth,
  scope,
  learnActive,
  last,
  onToggleEnabled,
  onProgramChange,
  onDepthChange,
  onScopeChange,
  onGenerate,
  onToggleLearn,
}: DeciPanelProps) {
  return (
    <HardwareSection title="Deci-Core · Arithmetic Patcher">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Toggle
            label="On"
            on={enabled}
            onClick={onToggleEnabled}
            title="Enable the deci-core arithmetic patcher"
          />
          {/* What the result drives: the waveform itself, or the knobs. */}
          <div className="flex gap-1.5">
            {SCOPE_OPTIONS.map((o) => (
              <Toggle
                key={o.id}
                label={o.label}
                on={scope === o.id}
                onClick={() => onScopeChange(o.id)}
                title={o.hint}
              />
            ))}
          </div>
          <Toggle
            label="Learn"
            on={learnActive}
            onClick={onToggleLearn}
            title="MIDI-learn: click, then press a hardware pad/key to bind it to Generate"
          />

          {/* Program digits */}
          <input
            value={program}
            onChange={(e) => onProgramChange(e.target.value.replace(/[^0-9]/g, ''))}
            spellCheck={false}
            inputMode="numeric"
            placeholder="digits 0–9"
            title="Deci-core program: a string of opcode digits 0–9"
            className="flex-1 min-w-[90px] bg-face2 border border-silk/25 rounded-[3px] px-2 py-1 vfd-text text-[11px] tracking-[0.18em] focus:border-phos/50 outline-none"
          />

          <HardwareButton
            label="Gen"
            lit={enabled}
            onClick={onGenerate}
            title="Sample the current audio, run the program, and re-program the synth"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Program presets */}
          <div className="flex gap-1 flex-wrap">
            {DECI_PROGRAMS.map((p) => (
              <button
                key={p.code}
                onClick={() => onProgramChange(p.code)}
                title={`${p.name} · ${p.code}`}
                className={`px-1.5 py-0.5 rounded-[2px] border text-[8px] uppercase tracking-wider cursor-pointer transition-colors ${
                  program === p.code
                    ? 'border-phos/50 text-phos'
                    : 'border-silk/20 text-dim hover:text-label'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Depth slider */}
          <label className="flex items-center gap-1.5 ml-auto">
            <span className="text-[8px] uppercase tracking-wider text-dim">Depth</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={depth}
              onChange={(e) => onDepthChange(Number(e.target.value))}
              className="w-20 accent-[#58ff8d]"
              title={
                scope === 'number'
                  ? 'How much of the number you hear — blends the arithmetic oscillator in (0 = silent, 1 = the curve alone)'
                  : 'How far to blend params toward the deci-driven target (0 = none, 1 = full)'
              }
            />
            <span className="vfd-text text-[9px] w-7 text-right">
              {Math.round(depth * 100)}%
            </span>
          </label>
        </div>

        {/* Readout of the last run */}
        <div className="vfd-text text-[9px] tracking-[0.1em] uppercase opacity-80 truncate">
          {last
            ? `seed ${fmtBig(last.seed)} → ${fmtBig(last.result)} · ${last.steps} steps · ${
                last.halted ? 'halted' : 'ran out'
              }`
            : scope === 'number'
              ? 'idle · press Gen to sample + become the waveform'
              : 'idle · press Gen to sample + re-program'}
        </div>
      </div>
    </HardwareSection>
  );
}
