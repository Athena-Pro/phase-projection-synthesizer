import React, { useEffect, useState } from 'react';
import { SynthParams } from '../types';
import { PARAM_SPECS } from '../lib/paramSpecs';
import { Knob, HardwareSection, SegmentGroup } from './ui';
import { DisplayMode } from './Display';

interface SynthControlsProps {
  params: SynthParams;
  onChange: (newParams: SynthParams) => void;
  onTouch: (key: keyof SynthParams, label: string, display: string) => void;
  /** Parameter currently focused by the controller's field-navigation keys. */
  focusedKey?: keyof SynthParams | null;
  /** The active display visual — selects which control domain is shown (VST-friendly). */
  visual: DisplayMode;
  /**
   * Which slice of the deck to render:
   * - `visual` (default): the controls that shape the active display, nested beneath it.
   * - `output`: the persistent Output · FX · Master strip, reachable in every view.
   */
  section?: 'visual' | 'output';
  /** Denser knobs + section padding, for pages that must fit the fixed frame. */
  compact?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const TWO_PI = 2 * Math.PI;

/** Constants worth hearing as curves — the arithmetic oscillator's quick picks. */
const ARITH_NUMBER_CHIPS = [
  { label: 'π', value: 3.141592653589793 },
  { label: 'φ', value: 1.618033988749895 },
  { label: 'e', value: 2.718281828459045 },
  { label: '√2', value: 1.4142135623730951 },
  { label: '22/7', value: 22 / 7 },
  { label: '1/3', value: 1 / 3 },
];

/** The sequence's later points, in walk order (point 1 is `arithValue`). */
const SEQ_FIELDS = ['arithValue2', 'arithValue3', 'arithValue4'] as const;

const ARITH_MAP_LABELS = ['raw', 'exp', 'joukowsky', 'möbius'];
const ARITH_EXTRACT_LABELS = ['real', 'imag', 'radius'];

/** Accept a decimal, or a fraction like "22/7". Returns null for anything unusable. */
function parseNumberEntry(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const slash = s.indexOf('/');
  if (slash > 0) {
    const num = Number(s.slice(0, slash));
    const den = Number(s.slice(slash + 1));
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    const v = num / den;
    return Number.isFinite(v) ? Math.abs(v) : null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? Math.abs(v) : null;
}

/** Name of the control domain packed under each display visual. */
const VIEW_LABEL: Record<DisplayMode, string> = {
  scope: 'Waveform',
  spect: 'Spectrum',
  tensor: 'Tensor · A⊗B',
  cp1: 'Projective · CP¹',
  orbit: 'Genesis Flow',
};

export default function SynthControls({
  params,
  onChange,
  onTouch,
  focusedKey,
  visual,
  section = 'visual',
  compact = false,
}: SynthControlsProps) {
  const knobSize = compact ? 34 : 42;
  // LINK couples Amt B and Angle Φ along the constant-pitch curve
  // sin(Φ)·AmtB = C (the pitch offset is sin(Φ)·AmtB·4 semitones).
  const [linkBend, setLinkBend] = useState(false);

  // The arithmetic oscillator's number lives in a text field, so it keeps its own draft state
  // (you can type "22/" without the patch jumping) and re-syncs when a preset or A/B swap
  // changes the number from outside.
  const [arithText, setArithText] = useState(() => String(params.arithValue));
  useEffect(() => {
    const parsed = parseNumberEntry(arithText);
    if (parsed === null || Math.abs(parsed - params.arithValue) > 1e-9) {
      setArithText(String(params.arithValue));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.arithValue]);

  // Same for the sequence's later points, which a deci Generate also rewrites.
  const seqCount = Math.max(1, Math.min(SEQ_FIELDS.length + 1, Math.round(params.arithSeqCount)));
  const seqValues = SEQ_FIELDS.map((k) => params[k] as number);
  const [seqText, setSeqText] = useState<string[]>(() => seqValues.map(String));
  useEffect(() => {
    setSeqText((prev) =>
      seqValues.map((v, i) => {
        const parsed = parseNumberEntry(prev[i] ?? '');
        return parsed !== null && Math.abs(parsed - v) <= 1e-9 ? prev[i] : String(v);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.arithValue2, params.arithValue3, params.arithValue4]);

  const applyLinked = (key: 'bendAngle' | 'bend2Amount', v: number): Partial<SynthParams> => {
    const C = Math.sin(params.bendAngle) * params.bend2Amount;

    if (key === 'bendAngle') {
      const s = Math.sin(v);
      // At sin(Φ)≈0 the lock is degenerate (any AmtB gives offset 0); hold AmtB.
      // Elsewhere compensate, saturating at the ±1 rails.
      const amtB = Math.abs(s) < 1e-3 ? params.bend2Amount : clamp(C / s, -1, 1);
      return { bendAngle: v, bend2Amount: Number(amtB.toFixed(4)) };
    }

    // key === 'bend2Amount': solve sin(Φ') = C / AmtB', pick the branch nearest Φ
    let x: number;
    if (Math.abs(v) < 1e-3) {
      x = Math.abs(C) < 1e-3 ? Math.sin(params.bendAngle) : 1;
    } else {
      x = clamp(C / v, -1, 1);
    }
    const a1 = Math.asin(x);
    const candidates = [a1, Math.PI - a1].map((a) => ((a % TWO_PI) + TWO_PI) % TWO_PI);
    const cur = params.bendAngle;
    const dist = (a: number) => Math.min(Math.abs(a - cur), TWO_PI - Math.abs(a - cur));
    const best = candidates.reduce((p, c) => (dist(c) < dist(p) ? c : p));
    return { bend2Amount: v, bendAngle: Number(best.toFixed(4)) };
  };

  const knob = (key: keyof SynthParams) => {
    const spec = PARAM_SPECS[key]!;
    const linkedKey = linkBend && (key === 'bendAngle' || key === 'bend2Amount');
    return (
      <Knob
        label={spec.label}
        value={params[key] as number}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        format={spec.format}
        defaultValue={spec.defaultValue}
        onChange={(v) =>
          onChange(
            linkedKey
              ? { ...params, ...applyLinked(key as 'bendAngle' | 'bend2Amount', v) }
              : { ...params, [key]: v }
          )
        }
        onTouch={(l, d) => onTouch(key, l, d)}
        focused={focusedKey === key}
        size={knobSize}
      />
    );
  };

  // ── Control sections, grouped by the display visual they sit under ───────────────

  const oscillatorSection = (
    <HardwareSection title="Oscillator" className="sm:col-span-2">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5 justify-between">
        {knob('bendPosition')}
        {knob('bendAmount')}
        {knob('bend2Position')}
        {knob('bend2Amount')}
        {knob('bendAngle')}
        {/* Pitch-lock link between Amt B and Angle Φ */}
        <button
          onClick={() => {
            setLinkBend((prev) => {
              const next = !prev;
              const st = Math.sin(params.bendAngle) * params.bend2Amount * 4.0;
              onTouch(
                'bendAngle',
                'Link',
                next ? `locked @ ${st >= 0 ? '+' : ''}${st.toFixed(2)}st` : 'off'
              );
              return next;
            });
          }}
          title="Lock Amt B and Angle Φ together so sin(Φ)·AmtB — the pitch offset — stays constant while the timbre evolves"
          className="flex flex-col items-center gap-1 cursor-pointer group self-center"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${linkBend ? 'led-on' : 'led-off'}`} />
          <span
            className={`px-1.5 h-5 rounded-[3px] border flex items-center text-[8px] uppercase tracking-wider transition-colors ${
              linkBend
                ? 'bg-phos/15 border-phos/50 text-phos'
                : 'bg-face2 border-silk/25 text-dim group-hover:border-silk/50'
            }`}
          >
            Link
          </span>
          <span className="text-[7px] tracking-wider uppercase text-dim">pitch lock</span>
        </button>
        {knob('modIndex')}
        {knob('modRatio')}
      </div>
    </HardwareSection>
  );

  // Second oscillator: a number read as a closed curve (its binary digits are the Fourier
  // coefficients of the curve's log radius), pushed through a conformal map, one lap of which
  // becomes the cycle. Number is a typed field rather than a knob — it is an arbitrary value,
  // not a range to sweep — with chips for the constants worth hearing.
  const arithmeticSection = (
    <HardwareSection title="Arithmetic · Boundary" className="sm:col-span-2">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[8px] tracking-wider uppercase text-dim">Number</span>
        <input
          type="text"
          value={arithText}
          onChange={(e) => {
            setArithText(e.target.value);
            const v = parseNumberEntry(e.target.value);
            if (v !== null) {
              onChange({ ...params, arithValue: v });
              onTouch('arithMix', 'Number', v.toPrecision(7));
            }
          }}
          title="Any positive number, or a fraction like 22/7. Only its first 52 binary places exist in a double — the Bits knob cannot see past that."
          className="w-24 px-1.5 h-5 rounded-[3px] bg-face2 border border-silk/25 text-[9px] text-silk font-mono focus:border-phos/50 focus:outline-none"
        />
        {ARITH_NUMBER_CHIPS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            title={`${chip.label} = ${chip.value}`}
            onClick={() => {
              setArithText(String(chip.value));
              onChange({ ...params, arithValue: chip.value });
              onTouch('arithMix', 'Number', chip.label);
            }}
            className={`px-1.5 h-5 rounded-[3px] border flex items-center text-[8px] uppercase tracking-wider transition-colors ${
              Math.abs(params.arithValue - chip.value) < 1e-9
                ? 'bg-phos/15 border-phos/50 text-phos'
                : 'bg-face2 border-silk/25 text-dim hover:border-silk/50'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {/* Sequence points 2..n — one number per genesis stage the note walks through. */}
      {seqCount > 1 && (
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[8px] tracking-wider uppercase text-dim">Walk to</span>
          {SEQ_FIELDS.slice(0, seqCount - 1).map((field, i) => (
            <React.Fragment key={field}>
              <span className="text-[8px] text-dim">›</span>
              <input
                type="text"
                value={seqText[i]}
                onChange={(e) => {
                  const next = [...seqText];
                  next[i] = e.target.value;
                  setSeqText(next);
                  const v = parseNumberEntry(e.target.value);
                  if (v !== null) {
                    onChange({ ...params, [field]: v });
                    onTouch('arithSeqCount', `Point ${i + 2}`, v.toPrecision(7));
                  }
                }}
                title={`Sequence point ${i + 2} of ${seqCount} — the number this note's timbre walks toward`}
                className="w-24 px-1.5 h-5 rounded-[3px] bg-face2 border border-silk/25 text-[9px] text-silk font-mono focus:border-phos/50 focus:outline-none"
              />
            </React.Fragment>
          ))}
          <SegmentGroup
            value={params.arithSeqMode}
            onChange={(v) => {
              onChange({ ...params, arithSeqMode: v });
              onTouch('arithSeqMode', 'Walk clock', v === 1 ? 'α time' : 'envelope');
            }}
            options={[
              { id: 0, label: 'env', hint: "Paced by the amplitude envelope's own sections: point 1 at onset, point 2 by the end of attack, point 3 held through sustain, the last reached as the release finishes" },
              { id: 1, label: 'time', hint: 'Paced by the α Time ramp instead, ignoring the envelope — a fixed-duration walk regardless of how long the key is held' },
            ]}
          />
        </div>
      )}
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('arithMix')}
        {knob('arithSeqCount')}
        {knob('arithBits')}
        {knob('arithDecay')}
        {knob('arithSwell')}
        {knob('arithWarp')}
        {knob('arithAngle')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.arithMap}
            onChange={(v) => {
              onChange({ ...params, arithMap: v });
              onTouch('arithMap', 'Conformal', ARITH_MAP_LABELS[v] ?? 'none');
            }}
            options={[
              { id: 0, label: 'raw', hint: 'No map — the bare arithmetic curve, its log radius written straight from the binary digits' },
              { id: 1, label: 'exp', hint: 'w = e^{kz} — entire, so the curve stays closed; wraps the radial wobble into an exponential horn' },
              { id: 2, label: 'jouk', hint: 'Joukowsky w = z + c²/z — the aerofoil map; folds the curve into a cusped wing, adding odd-harmonic edge' },
              { id: 3, label: 'möb', hint: 'Möbius disk automorphism w = (z−a)/(1−āz) — slides the curve off-center inside the disk, an asymmetric squash' },
            ]}
          />
          <SegmentGroup
            value={params.arithExtract}
            onChange={(v) => {
              onChange({ ...params, arithExtract: v });
              onTouch('arithExtract', 'Extract', ARITH_EXTRACT_LABELS[v] ?? 'real');
            }}
            options={[
              { id: 0, label: 're', hint: 'Read the real part of the mapped curve as the cycle' },
              { id: 1, label: 'im', hint: 'Read the imaginary part — the same curve a quarter-turn round, a different waveform from one shape' },
              { id: 2, label: '|w|', hint: 'Read the radius — always positive before DC removal, so the cycle follows the shape profile rather than tracing it' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const envelopeSection = (
    <HardwareSection title="Envelope">
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('attack')}
        {knob('decay')}
        {knob('sustain')}
        {knob('release')}
      </div>
    </HardwareSection>
  );

  const crossingSection = (
    <HardwareSection title="Crossing">
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('crossMix')}
        {knob('crossPhase')}
        {knob('crossShear')}
        {knob('crossConvolve')}
        {knob('crossWedge')}
        {knob('crossDifference')}
      </div>
    </HardwareSection>
  );

  const mobiusSection = (
    <HardwareSection title="Möbius · CP¹">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('mobiusRotate')}
        {knob('mobiusBoost')}
        {knob('mobiusTilt')}
        {knob('mobiusParabolic')}
        {knob('harmonicExponent')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.mobiusFlow}
            onChange={(v) => {
              onChange({ ...params, mobiusFlow: v });
              onTouch('mobiusFlow', 'Möbius', v === 1 ? 'flow' : 'static');
            }}
            options={[
              { id: 0, label: 'static', hint: 'Apply the Möbius transform to the steady spectrum' },
              { id: 1, label: 'flow', hint: 'Each note is born at the identity and flows along the CP¹ orbit to the set Möbius over the α-envelope time (needs a Möbius knob engaged)' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const canonicalSection = (
    <HardwareSection title="Canonical · α (LCT)">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('frftAngle')}
        {knob('frftSqueeze')}
        {knob('frftShear')}
        {knob('frftMix')}
        {knob('alphaEnvDepth')}
        {knob('alphaEnvTime')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.alphaEnvMode}
            onChange={(v) => {
              onChange({ ...params, alphaEnvMode: v });
              onTouch('alphaEnvMode', 'α sweep', v === 1 ? 'fall' : 'rise');
            }}
            options={[
              { id: 0, label: 'rise', hint: 'Sweep α from temporal (0) up to the set α Angle over the attack' },
              { id: 1, label: 'fall', hint: 'Start at the set α Angle and settle back to temporal' },
            ]}
          />
          <SegmentGroup
            value={params.cayleyLink}
            onChange={(v) => {
              onChange({ ...params, cayleyLink: v });
              onTouch('cayleyLink', 'Cayley', v === 1 ? 'linked' : 'off');
            }}
            options={[
              { id: 0, label: 'free', hint: 'The LCT acts only on the cycle' },
              { id: 1, label: 'C·gC⁻¹', hint: 'Cayley link: image this Angle/Squeeze/Chirp element onto the CP¹ spectrum as a Möbius transform too — one gesture moves the time-frequency plane and the harmonic sphere together' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const thetaSection = (
    <HardwareSection title="Theta · Talbot">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('thetaPhase')}
        {knob('thetaHeat')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.thetaFlow}
            onChange={(v) => {
              onChange({ ...params, thetaFlow: v });
              onTouch('thetaFlow', 'Theta', v === 1 ? 'flow' : 'static');
            }}
            options={[
              { id: 0, label: 'static', hint: 'Apply the quadratic phase to the steady spectrum' },
              { id: 1, label: 'flow', hint: 'Each note blooms τ from 0 (identity) to the set θ Phase/Heat over the α-envelope time, so the Talbot revival assembles over the note (needs θ Phase or θ Heat engaged)' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const operatorsSection = (
    <HardwareSection title="Operators">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('circulantOperatorStrength')}
        {knob('circulantKernelShift')}
        {knob('collatzGating')}
        {knob('combModulus')}
        {knob('padicTilt')}
      </div>
      <div className="mt-1.5">
        <SegmentGroup
          value={params.valuationBase}
          onChange={(v) => {
            onChange({ ...params, valuationBase: v });
            onTouch('valuationBase', 'Comb basis', `${v}`);
          }}
          options={[
            { id: 2, label: '2ad', hint: '2-adic valuation' },
            { id: 3, label: '3ad', hint: '3-adic valuation' },
            { id: 7, label: 'czs', hint: 'Collatz stopping time' },
            { id: 11, label: 'czp', hint: 'Collatz trajectory maximum' },
            { id: 13, label: 'siv', hint: 'Congruence sieve — drop harmonics sharing a prime factor with the Modulus M (e.g. M=10013=17·19·31)' },
          ]}
        />
      </div>
    </HardwareSection>
  );

  const operatorFocusSection = (
    <HardwareSection title="Operator · Focus">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.bandMode}
            onChange={(v) => {
              onChange({ ...params, bandMode: v });
              onTouch(
                'bandMode',
                'Focus band',
                v === 1 ? 'absolute Hz' : 'harmonic index'
              );
            }}
            options={[
              {
                id: 0,
                label: 'idx',
                hint: 'Focus centers on harmonic N^Focus — same relative partials on every note',
              },
              {
                id: 1,
                label: 'Hz',
                hint: 'Focus centers on 80 Hz–8 kHz so low notes pull more of the operator window into the body',
              },
            ]}
          />
        </div>
        {knob('operatorFocus')}
        {knob('operatorWidth')}
        {knob('focusTrack')}
        {knob('lowCouple')}
        {knob('spectralFold')}
        {knob('foldPeriod')}
        {knob('interfere')}
      </div>
    </HardwareSection>
  );

  const characterSection = (
    <HardwareSection title="Character · χ mod q">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('dirichletTwist')}
        {knob('dirichletOrder')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.dirichletModulus}
            onChange={(v) => {
              onChange({ ...params, dirichletModulus: v });
              onTouch('dirichletModulus', 'χ modulus', `mod ${v}`);
            }}
            options={[
              { id: 5, label: '5', hint: 'Character group (Z/5Z)* — order 4' },
              { id: 7, label: '7', hint: 'Character group (Z/7Z)* — order 6' },
              { id: 11, label: '11', hint: 'Character group (Z/11Z)* — order 10' },
              { id: 13, label: '13', hint: 'Character group (Z/13Z)* — order 12' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const heckeSection = (
    <HardwareSection title="Hecke · Tₚ">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('heckeMix')}
        {knob('heckeWeight')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.heckePrime}
            onChange={(v) => {
              onChange({ ...params, heckePrime: v });
              onTouch('heckePrime', 'Hecke prime', `T${v}`);
            }}
            options={[
              { id: 2, label: 'T₂', hint: 'Hecke operator at p = 2' },
              { id: 3, label: 'T₃', hint: 'Hecke operator at p = 3' },
              { id: 5, label: 'T₅', hint: 'Hecke operator at p = 5' },
              { id: 7, label: 'T₇', hint: 'Hecke operator at p = 7' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const cyclotomicSection = (
    <HardwareSection title="Cyclotomic · Galois">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('cyclotomicMix')}
        {knob('cyclotomicPower')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.cyclotomicAction}
            onChange={(v) => {
              onChange({ ...params, cyclotomicAction: v });
              onTouch('cyclotomicAction', 'Galois', v === 1 ? 'mirror' : 'spread');
            }}
            options={[
              { id: 0, label: 'spread', hint: 'Primitive root g — one long (P−1)-cycle, a maximal scramble of the partials' },
              { id: 1, label: 'mirror', hint: 'Multiply by −1 ≡ P−1 — swaps each partial n with P−n (order-2 reflection)' },
            ]}
          />
          <SegmentGroup
            value={params.cyclotomicFlow}
            onChange={(v) => {
              onChange({ ...params, cyclotomicFlow: v });
              onTouch('cyclotomicFlow', 'Cyclotomic', v === 1 ? 'flow' : 'static');
            }}
            options={[
              { id: 0, label: 'static', hint: 'Apply the permutation to the steady spectrum' },
              { id: 1, label: 'flow', hint: 'Each note blooms the permutation power t from 0 (identity) to the set Orbit t over the α-envelope time, so the anagram assembles over the note (needs Anagram engaged)' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const filterSection = (
    <HardwareSection title="Filter">
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('harmonicsCount')}
        {knob('cutoff')}
        {knob('resonance')}
      </div>
    </HardwareSection>
  );

  const pivotMotionSection = (
    <HardwareSection title="Pivot · Motion">
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('zeroStretch')}
        {knob('zeroInsert')}
        {knob('motionRate')}
        {knob('motionDepth')}
      </div>
    </HardwareSection>
  );

  const extensionSection = (
    <HardwareSection title="Extension · residue">
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('extendMix')}
        {knob('extendTime')}
        {knob('extendSkew')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.extendBloom}
            onChange={(v) => {
              onChange({ ...params, extendBloom: v });
              onTouch('extendBloom', 'Ext mode', v === 1 ? 'bloom' : 'decay');
            }}
            options={[
              { id: 0, label: 'decay', hint: 'Residue sounds at note-on, then fades — the operators arrive through time' },
              { id: 1, label: 'bloom', hint: 'Residue absent at note-on, then returns — the removed components arrive late' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const dopplerSection = (
    <HardwareSection title="Doppler · Room" dense={compact}>
      <div className="mb-1.5">
        <SegmentGroup
          value={params.fxRouting}
          onChange={(v) => {
            onChange({ ...params, fxRouting: v });
            onTouch('fxRouting', 'FX input', v === 1 ? 'pre-filter' : 'post-filter');
          }}
          options={[
            { id: 0, label: 'post', hint: 'Feed Parity and Doppler after the master low-pass' },
            { id: 1, label: 'pre', hint: 'Feed Parity and Doppler before the master low-pass so dark bass patches retain excitation' },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('dopplerMix')}
        {knob('dopplerSpeed')}
        {knob('dopplerRate')}
        {knob('dopplerShift')}
        {knob('dopplerSize')}
        {knob('dopplerDecay')}
        {knob('dopplerDamp')}
        <div className="flex flex-col gap-1 pt-1">
          <SegmentGroup
            value={params.dopplerMode}
            onChange={(v) => {
              onChange({ ...params, dopplerMode: v });
              onTouch('dopplerMode', 'Walls', v === 1 ? 'travel' : 'oscillate');
            }}
            options={[
              { id: 0, label: 'osc', hint: 'Oscillating walls — the tail warbles and detunes, tuning stays centered (native FDN)' },
              { id: 1, label: 'trav', hint: 'Traveling walls — a fixed shift compounds in the feedback loop, spiraling the tail endlessly up/down (shimmer worklet)' },
            ]}
          />
        </div>
      </div>
    </HardwareSection>
  );

  const paritySplitSection = (
    <HardwareSection title="Parity · Split" dense={compact}>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('parityMix')}
        {knob('parityBias')}
        {knob('parityToneUp')}
        {knob('parityToneDn')}
        {knob('parityDrive')}
        {knob('parityReso')}
        {knob('parityReverb')}
      </div>
    </HardwareSection>
  );

  const parityVowelSection = (
    <HardwareSection title="Parity · Vowel" dense={compact}>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('parityFormant')}
        {knob('parityVowelUp')}
        {knob('parityVowelDn')}
        {knob('parityKeyTrack')}
      </div>
    </HardwareSection>
  );

  const voiceSpaceSection = (
    <HardwareSection title="Voice · Space" dense={compact}>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1.5">
        {knob('unisonVoices')}
        {knob('detune')}
        {knob('spaceBoost')}
        {knob('spaceAngle')}
        {knob('volume')}
      </div>
    </HardwareSection>
  );

  // Spectral divergence across the unison stack: each voice's slot weight displaces a few
  // of the advanced modules for that voice alone, so Unison stops being one timbre copied
  // and detuned. Lives beside Voice · Space because it is the same stack those knobs build.
  const unisonExpanderSection = (
    <HardwareSection title="Unison · Expander" dense={compact}>
      <div className="mb-1.5 flex items-center gap-2">
        <SegmentGroup
          value={params.expandProfile}
          onChange={(v) => {
            onChange({ ...params, expandProfile: v });
            onTouch(
              'expandProfile',
              'Weights',
              v === 2 ? 'scatter' : v === 1 ? 'pair' : 'ramp'
            );
          }}
          options={[
            { id: 0, label: 'ramp', hint: 'Weights rise across the stack, tracking the detune/pan spread — flattest voice is also the leftmost; an odd stack keeps its center voice on the exact patch spectrum' },
            { id: 1, label: 'pair', hint: 'Signs alternate while magnitude grows outward — voices that sit next to each other in pitch and pan are the furthest apart in timbre' },
            { id: 2, label: 'scat', hint: 'Golden-ratio low-discrepancy weights — evenly covering, uncorrelated with pan, no voice is the center one' },
          ]}
        />
        <span className="text-[8px] tracking-wider uppercase text-dim">
          · at note-on
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-x-2.5 gap-y-1.5">
        {knob('expandAmount')}
        {knob('expandTheta')}
        {knob('expandOrbit')}
        {knob('expandTilt')}
        {knob('expandFocus')}
        {knob('expandAlpha')}
      </div>
    </HardwareSection>
  );

  // Each display visual packs its most relevant control sections; the output/FX + master
  // strip below is always visible so mix and level stay reachable in every view.
  const views: Record<DisplayMode, React.ReactNode> = {
    scope: (
      <>
        {oscillatorSection}
        {arithmeticSection}
        {envelopeSection}
      </>
    ),
    spect: (
      <>
        {thetaSection}
        {operatorsSection}
        {operatorFocusSection}
        {characterSection}
        {heckeSection}
        {cyclotomicSection}
        {filterSection}
      </>
    ),
    tensor: <>{crossingSection}</>,
    cp1: (
      <>
        {mobiusSection}
        {canonicalSection}
      </>
    ),
    orbit: (
      <>
        {pivotMotionSection}
        {extensionSection}
      </>
    ),
  };

  // Persistent output / FX + master strip — reachable under every visual.
  if (section === 'output') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-0.5">
          <span className="w-1.5 h-1.5 rounded-full led-on" />
          <span className="text-[9px] tracking-[0.22em] uppercase text-silk/80">
            Output · FX · Master
          </span>
          <span className="text-[8px] tracking-wider uppercase text-dim">
            · always on
          </span>
        </div>
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-1.5' : 'gap-2'}`}>
          {dopplerSection}
          {paritySplitSection}
          {parityVowelSection}
          {voiceSpaceSection}
          {unisonExpanderSection}
        </div>
      </div>
    );
  }

  // The controls that shape the active display, nested directly beneath it.
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className="w-1.5 h-1.5 rounded-full led-on" />
        <span className="text-[9px] tracking-[0.22em] uppercase text-silk/80">
          {VIEW_LABEL[visual]} Controls
        </span>
        <span className="text-[8px] tracking-wider uppercase text-dim">
          · shapes the display above
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{views[visual]}</div>
    </div>
  );
}
