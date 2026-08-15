import React, { useMemo, useRef, useEffect, useState } from 'react';
import { SynthParams, Vector3D } from '../types';
import { computeFourierSeries, waveStamp, STATIC_FLOW } from '../lib/audioEngine';
import { CYCLE_OPERATOR_IDS, CYCLE_OPERATORS } from '../lib/cycleOperators';
import { LAB_RESULT_IDS, LAB_RESULT_LABELS } from '../lib/operatorLab';

export type DisplayMode = 'scope' | 'spect' | 'tensor' | 'cp1' | 'orbit' | 'lab';

interface DisplayProps {
  params: SynthParams;
  mode: DisplayMode;
  isPlaying: boolean;
  referenceNote: number;
  bypassed: boolean;
  onChange: (next: SynthParams) => void;
}

const PHOS = '#58ff8d';
const PHOS_MID = 'rgba(88,255,141,0.45)';
const PHOS_DIM = 'rgba(88,255,141,0.18)';
const AMBER = 'rgba(255,180,84,0.8)';

/** Coordinate guard: a non-finite value must never reach an SVG/canvas coordinate. */
const fin = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

function tracePath(samples: number[], w: number, h: number, pad = 6): string {
  if (samples.length < 2) return '';
  const step = (w - pad * 2) / (samples.length - 1);
  return samples
    .map(
      (s, i) =>
        `${i === 0 ? 'M' : 'L'} ${(pad + i * step).toFixed(1)} ${fin(
          h / 2 - fin(s) * (h / 2 - pad),
          h / 2
        ).toFixed(1)}`
    )
    .join(' ');
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const noteLabel = (note: number) => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
const noteFrequency = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

export default function Display({ params, mode, isPlaying, referenceNote, bypassed, onChange }: DisplayProps) {
  const fourier = useMemo(
    () =>
      computeFourierSeries(
        params,
        params.harmonicsCount,
        STATIC_FLOW,
        noteFrequency(referenceNote),
        mode === 'lab'
      ),
    // waveStamp covers every spectral param; referenceNote matters in Hz band mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waveStamp(params), referenceNote, mode]
  );
  const referenceFrequency = noteFrequency(referenceNote);

  // Segre rank-1 residual for the status line (small N keeps it cheap)
  const segre = useMemo(() => {
    const { realA, imagA, realB, imagB } = fourier;
    const N = Math.min(8, params.harmonicsCount);
    let total = 0;
    let count = 0;
    for (let r = 1; r <= N; r++) {
      for (let s = 1; s <= N; s++) {
        const tRsRe = realA[r] * realB[s] - imagA[r] * imagB[s];
        const tRsIm = realA[r] * imagB[s] + imagA[r] * realB[s];
        for (let k = r + 1; k <= N; k++) {
          for (let l = s + 1; l <= N; l++) {
            const tKlRe = realA[k] * realB[l] - imagA[k] * imagB[l];
            const tKlIm = realA[k] * imagB[l] + imagA[k] * realB[l];
            const tRlRe = realA[r] * realB[l] - imagA[r] * imagB[l];
            const tRlIm = realA[r] * imagB[l] + imagA[r] * realB[l];
            const tKsRe = realA[k] * realB[s] - imagA[k] * imagB[s];
            const tKsIm = realA[k] * imagB[s] + imagA[k] * realB[s];
            const mRe = tRsRe * tKlRe - tRsIm * tKlIm - (tRlRe * tKsRe - tRlIm * tKsIm);
            const mIm = tRsRe * tKlIm + tRsIm * tKlRe - (tRlRe * tKsIm + tRlIm * tKsRe);
            total += Math.sqrt(mRe * mRe + mIm * mIm);
            count++;
          }
        }
      }
    }
    return count > 0 ? total / count : 0;
    // Depends on `fourier` alone: harmonicsCount is baked into the spectrum, so this
    // skips the O(N⁴) recompute unless the spectrum itself actually changed.
  }, [fourier]);

  return (
    <div className="flex flex-col border border-silk/25 rounded-sm overflow-hidden">
      <div className="phosphor relative aspect-[4/3] md:aspect-auto md:h-[228px]">
        {mode === 'scope' && <Scope fourier={fourier} params={params} />}
        {mode === 'spect' && (
          <Spectrum fourier={fourier} params={params} referenceFrequency={referenceFrequency} />
        )}
        {mode === 'tensor' && <Tensor fourier={fourier} params={params} />}
        {mode === 'cp1' && <CP1 fourier={fourier} />}
        {mode === 'orbit' && <Orbit fourier={fourier} params={params} isPlaying={isPlaying} />}
        {mode === 'lab' && <OperatorLab fourier={fourier} params={params} onChange={onChange} />}
      </div>
      <div className="bg-vfd border-t border-phos-dim/50 px-2.5 py-1 flex justify-between text-[8px] tracking-wider vfd-text opacity-90">
        <span>
          N={params.harmonicsCount} · REF {noteLabel(referenceNote)} {referenceFrequency.toFixed(1)}HZ ·{' '}
          {bypassed ? 'B BYPASS' : 'A PROCESSED'}
        </span>
        <span>
          {mode === 'lab' && fourier.lab
            ? `[A,B] RMS=${fourier.lab.metrics.commutatorRms.toExponential(2)} · [Π,A]=${fourier.lab.metrics.projectionCommutatorRms.toExponential(2)}`
            : `RANK-1 ε=${segre.toFixed(8)}`}
        </span>
      </div>
    </div>
  );
}

type FR = ReturnType<typeof computeFourierSeries>;

function normalizeForTrace(samples: number[]): number[] {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(fin(sample)));
  const scale = peak > 1e-9 ? 0.86 / peak : 1;
  return samples.map((sample) => fin(sample) * scale);
}

function OperatorLab({
  fourier,
  params,
  onChange,
}: {
  fourier: FR;
  params: SynthParams;
  onChange: (next: SynthParams) => void;
}) {
  const lab = fourier.lab;
  if (!lab) return null;
  const selected = lab.results[lab.selected];
  const selectedTrace = normalizeForTrace(selected.cycle);
  const abTrace = normalizeForTrace(lab.results.ab.cycle);
  const baTrace = normalizeForTrace(lab.results.ba.cycle);
  const update = (patch: Partial<SynthParams>) => onChange({ ...params, ...patch });
  const metrics = lab.metrics;

  return (
    <div className="h-full flex flex-col px-2 py-1.5 gap-1.5">
      <div className="flex items-center gap-1.5 text-[7px] uppercase tracking-wider">
        <label className="text-dim">A</label>
        <select
          className="bg-black/50 border border-phos-dim/70 text-phos rounded-[2px] px-1 py-0.5 outline-none"
          value={Math.round(params.labOperatorA ?? 0)}
          onChange={(event) => update({ labOperatorA: Number(event.target.value) })}
          aria-label="Operator A"
        >
          {CYCLE_OPERATOR_IDS.map((id, index) => (
            <option key={id} value={index}>{CYCLE_OPERATORS[id].label}</option>
          ))}
        </select>
        <label className="text-dim">B</label>
        <select
          className="bg-black/50 border border-phos-dim/70 text-phos rounded-[2px] px-1 py-0.5 outline-none"
          value={Math.round(params.labOperatorB ?? 2)}
          onChange={(event) => update({ labOperatorB: Number(event.target.value) })}
          aria-label="Operator B"
        >
          {CYCLE_OPERATOR_IDS.map((id, index) => (
            <option key={id} value={index}>{CYCLE_OPERATORS[id].label}</option>
          ))}
        </select>
        <select
          className="bg-black/50 border border-phos-dim/70 text-phos rounded-[2px] px-1 py-0.5 outline-none"
          value={Math.round(params.labResult ?? 4)}
          onChange={(event) => update({ labResult: Number(event.target.value) })}
          aria-label="Laboratory result"
        >
          {LAB_RESULT_IDS.map((id, index) => (
            <option key={id} value={index}>{LAB_RESULT_LABELS[id]}</option>
          ))}
        </select>
        <button
          type="button"
          className={`ml-auto border rounded-[2px] px-1.5 py-0.5 cursor-pointer ${
            (params.labEnabled ?? 0) > 0.5
              ? 'border-amber/70 text-amber bg-amber/10'
              : 'border-phos-dim/70 text-phos'
          }`}
          onClick={() => update({ labEnabled: (params.labEnabled ?? 0) > 0.5 ? 0 : 1 })}
          title="Route the selected laboratory result into the additive renderer"
        >
          {(params.labEnabled ?? 0) > 0.5 ? 'Auditioning' : 'Audition'}
        </button>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_126px] gap-2">
        <svg className="w-full h-full" viewBox="0 0 420 174" preserveAspectRatio="none" role="img" aria-label={`${selected.label} operator comparison`}>
          <line x1="0" y1="87" x2="420" y2="87" stroke={PHOS_DIM} strokeWidth="1" />
          <path d={tracePath(abTrace, 420, 174)} fill="none" stroke={AMBER} strokeWidth="0.8" strokeDasharray="3 4" opacity="0.55" />
          <path d={tracePath(baTrace, 420, 174)} fill="none" stroke={PHOS_MID} strokeWidth="0.8" strokeDasharray="2 3" opacity="0.55" />
          <path
            d={tracePath(selectedTrace, 420, 174)}
            fill="none"
            stroke={PHOS}
            strokeWidth="1.6"
            style={{ filter: 'drop-shadow(0 0 3px rgba(88,255,141,0.6))' }}
          />
          <text x="7" y="13" fill={PHOS} fontSize="8" fontFamily="inherit">{selected.label}</text>
          <text x="344" y="13" fill={AMBER} fontSize="6.5" fontFamily="inherit">AB ---</text>
          <text x="344" y="24" fill={PHOS} opacity="0.7" fontSize="6.5" fontFamily="inherit">BA ···</text>
        </svg>
        <div className="border-l border-phos-dim/50 pl-2 grid grid-cols-1 content-center gap-1 text-[7px] tracking-wide uppercase">
          <Metric label="Diff energy" value={metrics.differenceEnergy} />
          <Metric label="Spectral dist" value={metrics.spectralCosineDistance} />
          <Metric label="Magnitude" value={metrics.magnitudeDistance} />
          <Metric label="Phase" value={metrics.phaseDistance} />
          <Metric label="Entropy" value={metrics.entropy} />
          <Metric label="Centroid" value={metrics.spectralCentroid} digits={2} />
          <Metric label="Projection loss" value={metrics.projectionLoss} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, digits = 4 }: { label: string; value: number; digits?: number }) {
  return (
    <div className="flex justify-between gap-1">
      <span className="text-dim">{label}</span>
      <span className="text-phos">{Number.isFinite(value) ? value.toFixed(digits) : '—'}</span>
    </div>
  );
}

function Scope({ fourier, params }: { fourier: FR; params: SynthParams }) {
  const W = 420;
  const H = 228;
  const normAngle = (fin(params.bendAngle) % (2 * Math.PI)) / (2 * Math.PI);
  const b2 = (fin(params.bendPosition) + normAngle) % 1.0;
  const bpX = fin(params.bendPosition) * W;
  const b2X = fin(b2) * W;
  return (
    <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke={PHOS_DIM} strokeWidth="1" />
      <line x1={bpX} y1="0" x2={bpX} y2={H} stroke={PHOS_DIM} strokeDasharray="3 3" />
      <line x1={b2X} y1="0" x2={b2X} y2={H} stroke={AMBER} strokeOpacity="0.35" strokeDasharray="3 3" />
      {params.crossMix > 0.02 && (
        <path
          d={tracePath(fourier.samplesCross, W, H)}
          fill="none"
          stroke={PHOS_MID}
          strokeWidth="1"
          strokeDasharray="3 4"
        />
      )}
      <path
        d={tracePath(fourier.samples, W, H)}
        fill="none"
        stroke={PHOS}
        strokeWidth="1.6"
        style={{ filter: 'drop-shadow(0 0 3px rgba(88,255,141,0.6))' }}
      />
    </svg>
  );
}

function Spectrum({
  fourier,
  params,
  referenceFrequency,
}: {
  fourier: FR;
  params: SynthParams;
  referenceFrequency: number;
}) {
  const maxShow = Math.min(64, params.harmonicsCount);
  const bars = [];
  for (let n = 1; n <= maxShow; n++) {
    const mag = Math.sqrt(fourier.real[n] ** 2 + fourier.imag[n] ** 2);
    const cross = Math.sqrt(fourier.realCross[n] ** 2 + fourier.imagCross[n] ** 2);
    const resid = Math.sqrt(fourier.residReal[n] ** 2 + fourier.residImag[n] ** 2);
    bars.push({ n, mag, cross, resid });
  }
  const W = 420;
  const H = 228;
  const bw = (W - 12) / maxShow;
  const showResid = params.extendMix > 0.02;
  const maxHz = maxShow * referenceFrequency;
  const hzTicks = [referenceFrequency, 250, 500, 1000, 2000, 5000]
    .filter((hz, i, all) => hz <= maxHz && all.findIndex((v) => Math.abs(v - hz) < 20) === i)
    .map((hz) => ({ hz, harmonic: hz / referenceFrequency }));
  return (
    <svg
      className="w-full h-full"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Harmonic spectrum referenced to ${referenceFrequency.toFixed(1)} hertz`}
    >
      {hzTicks.map(({ hz, harmonic }) => {
        const x = 6 + (harmonic - 0.5) * bw;
        return (
          <g key={`${hz}-${harmonic}`}>
            <line x1={x} y1="0" x2={x} y2={H} stroke={PHOS_DIM} strokeWidth="0.6" strokeDasharray="2 4" />
            <text x={x + 2} y="11" fill={PHOS} opacity="0.6" fontSize="6.5" fontFamily="inherit">
              {hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : Math.round(hz)} Hz
            </text>
          </g>
        );
      })}
      {bars.map((b, i) => {
        const x = 6 + i * bw;
        const h = Math.min(H - 12, Math.max(2, b.mag * (H - 20)));
        const hc = Math.min(H - 12, b.cross * (H - 20));
        const hr = Math.min(H - 12, b.resid * (H - 20));
        return (
          <g key={b.n}>
            {/* Operator residue — the time-extended components */}
            {showResid && hr > 1 && (
              <rect
                x={x + bw * 0.12}
                y={H - 6 - hr}
                width={bw * 0.76}
                height={hr}
                fill="none"
                stroke={AMBER}
                strokeWidth="0.75"
                strokeDasharray="2 2"
                opacity="0.7"
              />
            )}
            {params.crossMix > 0.02 && hc > 1 && (
              <rect x={x + bw * 0.3} y={H - 6 - hc} width={bw * 0.4} height={hc} fill={AMBER} opacity="0.55" />
            )}
            <rect
              x={x + bw * 0.12}
              y={H - 6 - h}
              width={bw * 0.76}
              height={h}
              fill={PHOS}
              opacity="0.85"
            />
          </g>
        );
      })}
    </svg>
  );
}

function Tensor({ fourier, params }: { fourier: FR; params: SynthParams }) {
  const shear = Math.round(fin(params.crossShear));
  const conv = params.crossConvolve;
  const size = 16;
  const grid: number[][] = [];
  for (let r = 1; r <= size; r++) {
    const row: number[] = [];
    const ampA = Math.sqrt((fourier.realA[r] || 0) ** 2 + (fourier.imagA[r] || 0) ** 2);
    for (let s = 1; s <= size; s++) {
      const ampB = Math.sqrt((fourier.realB[s] || 0) ** 2 + (fourier.imagB[s] || 0) ** 2);
      row.push(ampA * ampB);
    }
    grid.push(row);
  }
  const cell = 100 / size;
  return (
    <div className="w-full h-full flex items-center justify-center">
      <svg className="h-[92%] aspect-square" viewBox="0 0 100 100">
        {grid.map((row, rIdx) =>
          row.map((val, sIdx) => {
            const intensity = Math.min(1, val * 8);
            const onSlice = rIdx === sIdx + shear;
            return (
              <rect
                key={`${rIdx}-${sIdx}`}
                x={sIdx * cell + 0.35}
                y={rIdx * cell + 0.35}
                width={cell - 0.7}
                height={cell - 0.7}
                fill={onSlice ? PHOS : '#58ff8d'}
                opacity={onSlice ? Math.max(0.2, intensity) : intensity * 0.3}
              />
            );
          })
        )}
        <line
          x1="0"
          y1={shear * cell}
          x2="100"
          y2={100 + shear * cell}
          stroke={PHOS}
          strokeOpacity="0.6"
          strokeWidth="0.8"
          strokeDasharray="1.5 1.5"
        />
        {conv > 0.05 &&
          [50, 100, 150].map((c) => (
            <line
              key={c}
              x1="0"
              y1={c}
              x2={c}
              y2="0"
              stroke={AMBER}
              strokeOpacity={0.6 * conv}
              strokeWidth="0.6"
              strokeDasharray="1 2"
            />
          ))}
      </svg>
    </div>
  );
}

function CP1({ fourier }: { fourier: FR }) {
  const [rot, setRot] = useState(0);
  useEffect(() => {
    let raf: number;
    let last = performance.now();
    const tick = (t: number) => {
      setRot((p) => (p + (t - last) * 0.0005) % (2 * Math.PI));
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const r1 = fin(fourier.real[1]) || 0.001;
  const i1 = fin(fourier.imag[1]) || 0;
  const den = r1 * r1 + i1 * i1 || 0.0001;
  const SLANT = 0.4;
  const R = 34;

  const points = [2, 3, 4].map((n) => {
    const rn = fin(fourier.real[n]);
    const iv = fin(fourier.imag[n]);
    const wRe = (rn * r1 + iv * i1) / den;
    const wIm = (iv * r1 - rn * i1) / den;
    // The stereographic map w ↦ sphere is bounded even as |w| → ∞ (heavy boost pushes
    // the node to the north pole rather than off-screen), so no magnitude clamp is
    // needed — but guard every coordinate against a non-finite w reaching the SVG.
    const mag = fin(Math.sqrt(wRe * wRe + wIm * wIm));
    const f = mag * mag + 1;
    const p = { x: (2 * wRe) / f, y: (2 * wIm) / f, z: (mag * mag - 1) / f };
    const x1 = p.x * Math.cos(rot) - p.z * Math.sin(rot);
    const z1 = p.x * Math.sin(rot) + p.z * Math.cos(rot);
    const y2 = p.y * Math.cos(SLANT) - z1 * Math.sin(SLANT);
    const z2 = p.y * Math.sin(SLANT) + z1 * Math.cos(SLANT);
    return {
      n,
      mag,
      phase: fin(Math.atan2(wIm, wRe)),
      px: fin(50 + x1 * R, 50),
      py: fin(50 - y2 * R, 50),
      z2: fin(z2),
      opacity: Math.max(0.3, (fin(z2) + 1.2) / 2.2),
    };
  });

  const poleOff = R * Math.sin(SLANT);

  return (
    <div className="w-full h-full grid grid-cols-3 items-center px-3">
      {points.map((pt) => (
        <div key={pt.n} className="flex flex-col items-center gap-0.5">
          <svg className="w-[104px] h-[140px]" viewBox="0 0 100 130">
            <circle cx="50" cy="50" r={R} fill="none" stroke={PHOS_DIM} strokeWidth="0.7" />
            <ellipse cx="50" cy="50" rx={R} ry={R * Math.sin(SLANT)} fill="none" stroke={PHOS_DIM} strokeWidth="0.7" />
            <ellipse
              cx="50"
              cy="50"
              rx={R * Math.abs(Math.cos(rot))}
              ry={R}
              fill="none"
              stroke={PHOS_DIM}
              strokeWidth="0.5"
            />
            <circle cx="50" cy={50 - poleOff} r="1.4" fill={AMBER} opacity="0.7" />
            <circle cx="50" cy={50 + poleOff} r="1.4" fill={AMBER} opacity="0.7" />
            <line
              x1="50"
              y1="50"
              x2={pt.px}
              y2={pt.py}
              stroke={PHOS_MID}
              strokeWidth="0.7"
              strokeDasharray="2 2"
              style={{ opacity: pt.opacity }}
            />
            <circle
              cx={pt.px}
              cy={pt.py}
              r={pt.z2 > 0 ? 3.4 : 2.2}
              fill={PHOS}
              style={{ opacity: pt.opacity, filter: 'drop-shadow(0 0 3px rgba(88,255,141,0.7))' }}
            />
            <text x="50" y="103" textAnchor="middle" fill={PHOS} opacity="0.85" fontSize="7" fontFamily="inherit">
              [H{pt.n}:H1]
            </text>
            <text x="50" y="114" textAnchor="middle" fill={PHOS} opacity="0.65" fontSize="6.5" fontFamily="inherit">
              |w| {pt.mag.toFixed(3)} · {Math.round((pt.phase * 180) / Math.PI)}°
            </text>
          </svg>
        </div>
      ))}
    </div>
  );
}

function Orbit({
  fourier,
  params,
  isPlaying,
}: {
  fourier: FR;
  params: SynthParams;
  isPlaying: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playheadRef = useRef(0);

  const K = 256;
  const trajectory = useMemo(() => {
    const raw: number[] = [];
    for (let j = 0; j < K; j++) {
      const idx = Math.min(
        fourier.samples.length - 1,
        Math.floor((j / K) * fourier.samples.length)
      );
      raw.push(fin(fourier.samples[idx]));
    }
    // Active Y calibration: normalize the waveform height to a stable range so heavy
    // filtering (a near-silent cycle) can't collapse the orbit to a clumped flat line,
    // and heavy boosting can't push it past the frame. x/z are already bounded.
    let maxAbs = 0;
    for (const y of raw) maxAbs = Math.max(maxAbs, Math.abs(y));
    const yScale = maxAbs > 1e-3 ? 0.95 / maxAbs : 1;
    const mr = fin(params.modRatio, 1);
    const pts: Vector3D[] = [];
    for (let j = 0; j < K; j++) {
      const theta = (j / K) * 2 * Math.PI;
      pts.push({
        x: Math.cos(theta),
        y: raw[j] * yScale,
        z: Math.sin(theta * mr) * (params.modIndex > 0 ? 0.7 : 0.2),
      });
    }
    return pts;
  }, [fourier, params.modRatio, params.modIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    let yaw = 0.6;
    let raf: number;

    const render = () => {
      if (!ctx) return;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      yaw += 0.005;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const cp = Math.cos(0.35);
      const sp = Math.sin(0.35);

      const project = (v: Vector3D) => {
        const x1 = v.x * cy - v.z * sy;
        const z1 = v.x * sy + v.z * cy;
        const y2 = v.y * cp - z1 * sp;
        const z2 = v.y * sp + z1 * cp;
        // Clamp the perspective denominator so a node near the camera plane can't send
        // the projection to infinity (which reads as nodes clumping / flying off).
        const denom = Math.max(0.35, 2.5 + z2);
        const scale = ((1.15 * Math.min(w, h)) / denom) * 0.45;
        return { x: fin(w / 2 + x1 * scale, w / 2), y: fin(h / 2 - y2 * scale, h / 2), z2 };
      };

      const pts = trajectory.map(project);
      ctx.lineWidth = 1.6;
      for (let j = 0; j < K; j++) {
        const p1 = pts[j];
        const p2 = pts[(j + 1) % K];
        const opacity = Math.max(0.1, 1.0 - (((p1.z2 + p2.z2) / 2 + 1) * 0.42));
        ctx.strokeStyle = `rgba(88,255,141,${opacity})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      playheadRef.current = (playheadRef.current + (isPlaying ? 0.02 : 0.004)) % 1.0;
      const head = pts[Math.floor(playheadRef.current * (K - 1))];
      if (head) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }

      raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [trajectory, isPlaying]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
