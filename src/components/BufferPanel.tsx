import React from 'react';
import { HardwareSection, HardwareButton } from './ui';
import {
  BufferParams,
  BUFFER_METHOD_HINTS,
  bandAssignment,
} from '../lib/bufferTransformer';

interface BufferPanelProps {
  params: BufferParams;
  onChange: (next: BufferParams) => void;
  active: boolean;
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

function Row({
  label,
  hint,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2" title={hint}>
      <span className="text-[8px] uppercase tracking-wider text-dim w-[68px] shrink-0">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[#58ff8d] h-1 min-w-0"
      />
      <span className="vfd-text text-[9px] w-[52px] text-right tabular-nums">{display}</span>
    </label>
  );
}

/**
 * Buffer transformer panel.
 *
 * The map at the top is the point of the module: it shows, band by band, which operator is
 * running and how far into the past that band is being read from. Turning Time Skew tilts the
 * whole column into history; turning Method Skew marches the operators diagonally up it.
 */
export default function BufferPanel({ params, onChange, active }: BufferPanelProps) {
  const set = (patch: Partial<BufferParams>) => onChange({ ...params, ...patch });
  const segments = Math.max(1, Math.min(32, Math.round(params.segments)));
  const bands = Array.from({ length: segments }, (_, i) => {
    const { method, lag } = bandAssignment(i, params);
    return { band: i, method, lag };
  });
  const frameMs = 1000 / 60;

  return (
    <HardwareSection title="Buffer · Diagonal Resynthesis">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <Toggle
            label="On"
            on={params.enabled}
            onClick={() => set({ enabled: !params.enabled })}
            title="Resynthesize the master bus through the diagonal buffer. The bank listens ahead of the monitor, so it never hears itself."
          />
          <Toggle
            label={params.distribution >= 0.5 ? 'Lin' : 'Log'}
            on={params.distribution < 0.5}
            onClick={() => set({ distribution: params.distribution >= 0.5 ? 0 : 1 })}
            title="Oscillator spacing: logarithmic (musical) or linear (aligned to the FFT bins)"
          />
          <span className="vfd-text text-[9px] tracking-[0.1em] uppercase opacity-80">
            {params.enabled ? (active ? `${bands.length} bands live` : 'engine standby') : 'bypassed'}
          </span>
        </div>

        {/* Band map: the diagonal, made visible */}
        <div className="flex flex-col-reverse gap-[2px] border border-silk/15 rounded-sm p-1.5">
          {bands.map(({ band, method, lag }) => (
            <div
              key={band}
              className="flex items-center gap-1.5"
              title={`Band ${band + 1}: ${BUFFER_METHOD_HINTS[method]} · reading ${lag} frame${lag === 1 ? '' : 's'} back (~${Math.round(lag * frameMs)} ms)`}
            >
              <span className="text-[7px] text-dim w-4 shrink-0 text-right tabular-nums">
                {band + 1}
              </span>
              <span
                className={`px-1 h-3.5 rounded-[2px] border text-[7px] uppercase tracking-wider flex items-center shrink-0 ${
                  method === 'pass'
                    ? 'border-silk/20 text-dim'
                    : 'border-phos/40 text-phos bg-phos/10'
                }`}
              >
                {method}
              </span>
              {/* Lag bar — how far into the past this band is read from */}
              <span className="flex-1 h-1.5 bg-face2 rounded-[1px] overflow-hidden min-w-0">
                <span
                  className="block h-full bg-phos/50"
                  style={{ width: `${Math.min(100, (lag / 64) * 100)}%` }}
                />
              </span>
              <span className="vfd-text text-[7px] w-9 text-right tabular-nums opacity-80">
                {lag ? `${Math.round(lag * frameMs)}ms` : 'now'}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
          <Row
            label="Bands"
            hint="How many frequency segments the spectrum is cut into"
            value={params.segments}
            min={1}
            max={16}
            step={1}
            display={`${segments}`}
            onChange={(v) => set({ segments: v })}
          />
          <Row
            label="Time Skew"
            hint="Frames of extra lag per band — the diagonal's slope through time. At 0 every band reads the present."
            value={params.timeSkew}
            min={0}
            max={24}
            step={0.5}
            display={`${params.timeSkew}f`}
            onChange={(v) => set({ timeSkew: v })}
          />
          <Row
            label="Method Skew"
            hint="How far the operator assignment advances per band. At 0 every band gets the same method."
            value={params.methodSkew}
            min={0}
            max={4}
            step={1}
            display={`${params.methodSkew}`}
            onChange={(v) => set({ methodSkew: v })}
          />
          <Row
            label="Method Off"
            hint="Rotates the whole operator assignment up or down the spectrum"
            value={params.methodOffset}
            min={0}
            max={7}
            step={1}
            display={`${params.methodOffset}`}
            onChange={(v) => set({ methodOffset: v })}
          />
          <Row
            label="Jitter"
            hint="Chance per frame that a band slips further into the past — the reference design's misread, now per band"
            value={params.jitter}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(params.jitter * 100)}%`}
            onChange={(v) => set({ jitter: v })}
          />
          <Row
            label="Pitch"
            hint="Multiplies every oscillator frequency — a spectral transposition, with no effect on timing"
            value={params.pitchShift}
            min={0.25}
            max={4}
            step={0.01}
            display={`${params.pitchShift.toFixed(2)}×`}
            onChange={(v) => set({ pitchShift: v })}
          />
          <Row
            label="Oscs"
            hint="Sine oscillators in the resynthesis bank"
            value={params.oscCount}
            min={16}
            max={256}
            step={1}
            display={`${Math.round(params.oscCount)}`}
            onChange={(v) => set({ oscCount: v })}
          />
          <Row
            label="Smoothing"
            hint="Analyser time smoothing — averages frames before they enter the ring"
            value={params.smoothing}
            min={0}
            max={0.99}
            step={0.01}
            display={params.smoothing.toFixed(2)}
            onChange={(v) => set({ smoothing: v })}
          />
          <Row
            label="Sieve M"
            hint="Modulus of the sieve method: bins sharing a factor with it are notched"
            value={params.sieveModulus}
            min={2}
            max={32}
            step={1}
            display={`M${Math.round(params.sieveModulus)}`}
            onChange={(v) => set({ sieveModulus: v })}
          />
          <Row
            label="Fold K"
            hint="Period of the fold method — bins wrap onto this many slots"
            value={params.foldPeriod}
            min={2}
            max={32}
            step={1}
            display={`K${Math.round(params.foldPeriod)}`}
            onChange={(v) => set({ foldPeriod: v })}
          />
          <Row
            label="Blur"
            hint="Bin radius of the blur method"
            value={params.blurWidth}
            min={1}
            max={12}
            step={1}
            display={`±${Math.round(params.blurWidth)}`}
            onChange={(v) => set({ blurWidth: v })}
          />
          <Row
            label="Mix"
            hint="Level of the resynthesis against the dry synth"
            value={params.mix}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(params.mix * 100)}%`}
            onChange={(v) => set({ mix: v })}
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[8px] uppercase tracking-wider text-dim">Window</span>
          {[1024, 2048, 4096, 8192].map((size) => (
            <button
              key={size}
              onClick={() => set({ fftSize: size })}
              title={`${size}-sample analysis window — larger resolves frequency more finely and smears transients`}
              className={`px-1.5 py-0.5 rounded-[2px] border text-[8px] uppercase tracking-wider cursor-pointer transition-colors ${
                params.fftSize === size
                  ? 'border-phos/50 text-phos'
                  : 'border-silk/20 text-dim hover:text-label'
              }`}
            >
              {size}
            </button>
          ))}
          <HardwareButton
            label="Flat"
            lit={params.timeSkew === 0 && params.methodSkew === 0}
            onClick={() => set({ timeSkew: 0, methodSkew: 0, methodOffset: 0 })}
            title="Reset the diagonal: every band reads the present through the same method — an ordinary resynthesizer"
          />
        </div>
      </div>
    </HardwareSection>
  );
}
