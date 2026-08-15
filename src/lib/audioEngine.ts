import { SynthParams } from '../types';
import { ARITH_COEFF_PAIRS } from './paramSpecs';
import { getWorkletUrl } from './additiveWorklet';
import { DopplerReverb, DopplerParams } from './dopplerReverb';
import { getShimmerWorkletUrl } from './shimmerWorklet';
import { getTickerWorkletUrl } from './tickerWorklet';
import { ParitySplit, ParityParams } from './paritySplit';
import { schwarzChristoffelBoundary } from './schwarzChristoffel';
import { runPreProjectionProgram, CycleOperatorContext } from './cycleOperators';
import { projectCycle } from './harmonicProjection';
import { analyzeOperatorLab, OperatorLabAnalysis } from './operatorLab';

export { applyZeroPivotTransform } from './zeroPivot';

export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export function evaluateDoubleBentSaw(
  phi: number,
  alpha1: number,
  yb1: number,
  alpha2: number,
  yb2: number,
  bendAngle: number
): number {
  let p = phi % (2 * Math.PI);
  if (p < 0) p += 2 * Math.PI;
  const pNorm = p / (2 * Math.PI); // 0 to 1

  // Second joint is positioned relative to first joint by bendAngle
  const normAngle = (bendAngle % (2 * Math.PI)) / (2 * Math.PI);
  const p1 = alpha1;
  const p2 = (alpha1 + normAngle) % 1.0;

  const t1 = Math.min(p1, p2);
  const t2 = Math.max(p1, p2);

  let v1 = yb1;
  let v2 = yb2;

  if (p1 > p2) {
    v1 = yb2;
    v2 = yb1;
  }

  if (t1 === t2) {
    if (pNorm < t1) {
      const t = pNorm / t1;
      return -1 + t * (v1 + 1);
    } else {
      const t = (pNorm - t1) / (1 - t1);
      return v1 - t * (v1 + 1);
    }
  }

  if (pNorm < t1) {
    const t = pNorm / t1;
    return -1 + t * (v1 + 1);
  } else if (pNorm < t2) {
    const t = (pNorm - t1) / (t2 - t1);
    return v1 + t * (v2 - v1);
  } else {
    const t = (pNorm - t2) / (1 - t2);
    return v2 - t * (-1 - v2);
  }
}

export function evaluateSingleBentSaw(phi: number, alpha: number, yb: number): number {
  let p = phi % (2 * Math.PI);
  if (p < 0) p += 2 * Math.PI;
  const pNorm = p / (2 * Math.PI); // 0 to 1
  if (pNorm < alpha) {
    const t = pNorm / alpha;
    return -1 + t * (yb + 1);
  } else {
    const t = (pNorm - alpha) / (1 - alpha);
    return yb - t * (yb + 1);
  }
}

export function evaluateModulatedSingleBentSaw(
  theta: number,
  alpha: number,
  yb: number,
  modIndex: number,
  modRatio: number
): number {
  const modulator = Math.sin(theta * modRatio);
  const phi = theta + modIndex * modulator;
  return evaluateSingleBentSaw(phi, alpha, yb);
}

export function evaluateModulatedBentSaw(
  theta: number,
  alpha: number,
  yb: number,
  alpha2: number,
  yb2: number,
  bendAngle: number,
  modIndex: number,
  modRatio: number
): number {
  const modulator = Math.sin(theta * modRatio);
  const phi = theta + modIndex * modulator;
  return evaluateDoubleBentSaw(phi, alpha, yb, alpha2, yb2, bendAngle);
}

// ── Arithmetic boundary source ──────────────────────────────────────────────────────────
//
// A second oscillator, sitting beside the bent saw: it reads a *number* as a closed curve
// and hands one lap of that curve to the resynthesis chain as a cycle of audio.
//
// Two shape spaces share the same coefficient pairs and the same extract/morph stage:
//
//   A. Fourier-in-log-r (maps 0–3). Binary / edit coefficients build
//        log r(θ) = Σ_k k^{−s} (d_k cos kθ + e_k sin kθ),
//      the star-shaped curve z = r e^{iθ} is pushed through a conformal map (none / exp /
//      Joukowsky / Möbius), and one component of w is the cycle.
//   B. Schwarz–Christoffel (map 4). The same pairs are read as a polygon: d_k → prevertex
//      spacing on S¹, e_k → interior-angle weights β_k with Σ β = n−2. The SC map of the
//      unit disk sends the circle to the polygon boundary — a different spectrum (poles at
//      the prevertices) that no Fourier-in-log-r curve can reach.
//
// The curve is parameterized by θ, and since r > 0 we have arg z ≡ θ exactly. That matters:
// computing arg z with a principal-branch atan2 (the obvious way) puts a 2π jump on the
// negative real axis, which lands in the audio as a click and makes the "cycle" not a cycle.
// Parameterizing by θ removes the branch cut by construction, and the maps offered below are
// all single-valued in z, so w(θ) is continuous and 2π-periodic — a genuinely closed cycle.
// That is also why the non-integer power map and the log map are absent: both are
// multivalued, and their principal branches do not close up over one lap.

/** A double carries 52 mantissa bits; past that a binary expansion is all zeros. */
export const ARITH_MAX_BITS = 52;

/** Highest number of sequence points a note can walk through. */
export const ARITH_SEQ_MAX = 4;

/** The sequence numbers actually in play, in order (length = clamped arithSeqCount). */
export function arithSequence(p: SynthParams): number[] {
  const count = Math.max(1, Math.min(ARITH_SEQ_MAX, Math.round(p.arithSeqCount)));
  return [p.arithValue, p.arithValue2, p.arithValue3, p.arithValue4].slice(0, count);
}

/**
 * True when a note traverses more than one number.
 *
 * The curve has two consumers, so a walk is audible through either: the blend into the main
 * cycle (`arithMix`), and the regime split reading the curve as its rule-B source. Gating on
 * `arithMix` alone would silently freeze the walk for a patch that hears the number only
 * through the split.
 */
export function arithSequenceActive(p: SynthParams): boolean {
  const heard = p.arithMix > 0.001 || (p.regimeMix > 0.001 && Math.round(p.regimeSource) === 2);
  return heard && arithSequence(p).length > 1;
}

/** Conformal / source maps available to the arithmetic oscillator (0..4, a SegmentGroup). */
export const ARITH_MAPS = ['none', 'exp', 'joukowsky', 'mobius', 'sc'] as const;

/** Raw (d, e) pairs from edit sliders or the number's leading bits — shared by Fourier and SC. */
function arithRawCoeffs(p: SynthParams, count: number): { d: Float64Array; e: Float64Array } {
  const d = new Float64Array(count);
  const e = new Float64Array(count);
  if (p.arithCoeffMode >= 0.5) {
    const rec = p as unknown as Record<string, number>;
    for (let k = 0; k < count; k++) {
      d[k] = rec[`arithD${k + 1}`] ?? 0;
      e[k] = rec[`arithE${k + 1}`] ?? 0;
    }
  } else {
    let intPart = Math.floor(Math.abs(p.arithValue));
    let frac = Math.abs(p.arithValue) - intPart;
    for (let k = 0; k < count; k++) {
      d[k] = intPart % 2;
      intPart = Math.floor(intPart / 2);
      frac *= 2;
      e[k] = frac >= 1 ? 1 : 0;
      frac -= e[k];
    }
  }
  return { d, e };
}

/**
 * One cycle of the arithmetic boundary, mean-removed and peak-normalized to ±1 (the DFT
 * discards DC anyway, but the blend against the bent saw needs both cycles on one scale).
 *
 * The radius is normalized so max r = 1 for every setting, which is what keeps the maps
 * well-behaved: `exp` stays inside e^{|k|}, `joukowsky`'s pole at 0 is never approached
 * (min r = e^{−2·swell}), and `mobius` acts on the closed unit disk it was built for, so its
 * pole at 1/ā is outside the curve for any |a| < 1. `swell` then reads as the depth of the
 * radial wobble rather than as a gain that can run away — the original 1/k series is the
 * harmonic series, so with many 1-bits its log radius grows like ln(bits).
 * On the SC path, `swell` softens the polygon toward regular; `warp`/`angle` set accessory C.
 */
export function arithmeticCycle(p: SynthParams, K: number): Float64Array {
  const map = Math.round(p.arithMap);
  const extract = Math.round(p.arithExtract);
  const morph = Math.max(0, Math.min(1, p.arithMorph));
  // Chord: (1−α)Re + α·Im. Geodesic: unit-circle rotation of the readout axis — same
  // Re/Im endpoints, mid-α differs by √2 gain and equal-energy path.
  const morphGeo = p.arithMorphMode >= 0.5;
  const morphC = morphGeo ? Math.cos(morph * Math.PI * 0.5) : 1 - morph;
  const morphS = morphGeo ? Math.sin(morph * Math.PI * 0.5) : morph;

  const finish = (wr: Float64Array, wi: Float64Array): Float64Array => {
    const out = new Float64Array(K);
    for (let j = 0; j < K; j++) {
      out[j] =
        extract === 1
          ? wi[j]
          : extract === 2
            ? Math.hypot(wr[j], wi[j])
            : extract === 3
              ? morphC * wr[j] + morphS * wi[j]
              : wr[j];
    }
    let mean = 0;
    for (let j = 0; j < K; j++) mean += out[j];
    mean /= K;
    let peak = 0;
    for (let j = 0; j < K; j++) {
      out[j] -= mean;
      const a = Math.abs(out[j]);
      if (a > peak) peak = a;
    }
    if (peak > 1e-9) {
      const g = 1 / peak;
      for (let j = 0; j < K; j++) out[j] *= g;
    }
    return out;
  };

  // Schwarz–Christoffel polygon: d/e → prevertices + β, boundary is the cycle.
  if (map === 4) {
    const { d, e } = arithRawCoeffs(p, ARITH_COEFF_PAIRS);
    const soften = Math.max(0, Math.min(1, p.arithSwell / 1.5));
    const cAbs = 0.2 + 0.8 * Math.max(0, Math.min(1, p.arithWarp));
    const { re, im } = schwarzChristoffelBoundary(d, e, K, soften, cAbs, p.arithAngle);
    return finish(re, im);
  }

  // Coefficients come either from the number's binary expansion or from the editable pairs.
  // Both feed the same k^{−s} weighting, so switching modes changes only where d and e come
  // from — bits give 0/1 at up to 52 terms, hand-dialled pairs give continuous values at 8.
  const editing = p.arithCoeffMode >= 0.5;
  const bits = editing
    ? ARITH_COEFF_PAIRS
    : Math.max(1, Math.min(ARITH_MAX_BITS, Math.round(p.arithBits)));
  const value = Math.abs(p.arithValue);
  let intPart = Math.floor(value);
  let frac = value - intPart;

  // Integer part low bit first (cosines), fraction high bit first (sines). Division rather
  // than >> because a double's integer part can exceed 32 bits.
  const cosAmp = new Float64Array(bits);
  const sinAmp = new Float64Array(bits);
  let used = 0;
  for (let k = 0; k < bits; k++) {
    const amp = Math.pow(k + 1, -p.arithDecay);
    let d: number;
    let e: number;
    if (editing) {
      d = (p as unknown as Record<string, number>)[`arithD${k + 1}`] ?? 0;
      e = (p as unknown as Record<string, number>)[`arithE${k + 1}`] ?? 0;
    } else {
      d = intPart % 2;
      intPart = Math.floor(intPart / 2);
      frac *= 2;
      e = frac >= 1 ? 1 : 0;
      frac -= e;
    }
    cosAmp[k] = d * amp;
    sinAmp[k] = e * amp;
    if (d !== 0 || e !== 0) used++;
  }

  const logR = new Float64Array(K);
  if (used > 0) {
    for (let j = 0; j < K; j++) {
      const theta = (j / K) * 2 * Math.PI;
      const c1 = Math.cos(theta);
      const s1 = Math.sin(theta);
      let cn = c1;
      let sn = s1;
      let acc = 0;
      for (let k = 0; k < bits; k++) {
        acc += cosAmp[k] * cn + sinAmp[k] * sn;
        const cNext = cn * c1 - sn * s1;
        sn = sn * c1 + cn * s1;
        cn = cNext;
      }
      logR[j] = acc;
    }
    // Scale to the requested swell, then drop the peak to r = 1.
    let peak = 0;
    for (let j = 0; j < K; j++) peak = Math.max(peak, Math.abs(logR[j]));
    const scale = peak > 1e-12 ? p.arithSwell / peak : 0;
    for (let j = 0; j < K; j++) logR[j] = logR[j] * scale - p.arithSwell;
  }

  const warp = p.arithWarp;
  const ca = Math.cos(p.arithAngle);
  const sa = Math.sin(p.arithAngle);
  const wrArr = new Float64Array(K);
  const wiArr = new Float64Array(K);

  for (let j = 0; j < K; j++) {
    const theta = (j / K) * 2 * Math.PI;
    const r = Math.exp(logR[j]);
    const zr = r * Math.cos(theta);
    const zi = r * Math.sin(theta);
    let wr = zr;
    let wi = zi;

    if (map === 1) {
      // w = exp(k·z), k = 1.5·warp·e^{iφ} — entire, so nothing to guard.
      const kr = 1.5 * warp * ca;
      const ki = 1.5 * warp * sa;
      const er = kr * zr - ki * zi;
      const ei = kr * zi + ki * zr;
      const m = Math.exp(er);
      wr = m * Math.cos(ei);
      wi = m * Math.sin(ei);
    } else if (map === 2) {
      // Joukowsky w = z + c²/z, c = warp·e^{iφ}. |z| ≥ e^{−2·swell} > 0.
      const cr = warp * ca;
      const ci = warp * sa;
      const c2r = cr * cr - ci * ci;
      const c2i = 2 * cr * ci;
      const den = zr * zr + zi * zi;
      if (den > 1e-12) {
        wr = zr + (c2r * zr + c2i * zi) / den;
        wi = zi + (c2i * zr - c2r * zi) / den;
      }
    } else if (map === 3) {
      // Disk automorphism w = (z − a)/(1 − ā z), |a| < 1 strictly so the pole stays outside.
      const ar = 0.95 * warp * ca;
      const ai = 0.95 * warp * sa;
      const nr = zr - ar;
      const ni = zi - ai;
      const dr = 1 - (ar * zr + ai * zi);
      const di = -(ar * zi - ai * zr);
      const den = dr * dr + di * di;
      if (den > 1e-12) {
        wr = (nr * dr + ni * di) / den;
        wi = (ni * dr - nr * di) / den;
      }
    }

    wrArr[j] = wr;
    wiArr[j] = wi;
  }

  return finish(wrArr, wiArr);
}

export function getCollatzStoppingTime(n: number): number {
  let steps = 0;
  let val = n;
  while (val > 1 && steps < 120) {
    if (val % 2 === 0) {
      val = val / 2;
    } else {
      val = 3 * val + 1;
    }
    steps++;
  }
  return steps;
}

export function getCollatzMax(n: number): number {
  let maxVal = n;
  let val = n;
  let steps = 0;
  while (val > 1 && steps < 120) {
    if (val % 2 === 0) {
      val = val / 2;
    } else {
      val = 3 * val + 1;
    }
    if (val > maxVal) maxVal = val;
    steps++;
  }
  return maxVal;
}

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function getPAdicValuation(n: number, p: number): number {
  if (n <= 0) return 0;
  let count = 0;
  let val = n;
  while (val % p === 0) {
    count++;
    val = Math.floor(val / p);
  }
  return count;
}

function modPow(base: number, exp: number, mod: number): number {
  let result = 1;
  base %= mod;
  while (exp > 0) {
    if (exp & 1) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1;
  }
  return result;
}

function distinctPrimeFactors(n: number): number[] {
  const factors: number[] = [];
  let m = n;
  for (let d = 2; d * d <= m; d++) {
    if (m % d === 0) {
      factors.push(d);
      while (m % d === 0) m = Math.floor(m / d);
    }
  }
  if (m > 1) factors.push(m);
  return factors;
}

/**
 * Discrete-log index table for the cyclic group (Z/qZ)* of an odd prime q.
 *
 * Finds the least primitive root g (a generator) and tabulates ind[a] with g^{ind[a]} ≡ a.
 * The full family of Dirichlet characters mod q is then χ_k(a) = e^{2πi·k·ind[a]/(q−1)},
 * χ_k(a) = 0 when q | a. k = 0 is the principal character; k = (q−1)/2 is the real
 * quadratic (Legendre) character, where e^{iπ·ind[a]} = (−1)^{ind[a]} = (a/q).
 */
function dirichletIndexTable(q: number): Int32Array {
  const phi = q - 1;
  const factors = distinctPrimeFactors(phi);
  let g = 2;
  for (; g < q; g++) {
    let isRoot = true;
    for (const f of factors) {
      if (modPow(g, phi / f, q) === 1) {
        isRoot = false;
        break;
      }
    }
    if (isRoot) break;
  }
  const ind = new Int32Array(q);
  let cur = 1;
  for (let j = 0; j < phi; j++) {
    ind[cur] = j;
    cur = (cur * g) % q;
  }
  return ind;
}

function isPrimeInt(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let d = 3; d * d <= n; d += 2) if (n % d === 0) return false;
  return true;
}

/** Largest prime ≤ n (≥ 2). Used to size the cyclotomic permutation's group (Z/PZ)*. */
function largestPrimeLE(n: number): number {
  for (let p = Math.floor(n); p >= 2; p--) if (isPrimeInt(p)) return p;
  return 2;
}

/** Least primitive root g of an odd prime P — a generator of the cyclic group (Z/PZ)*. */
function leastPrimitiveRoot(P: number): number {
  const phi = P - 1;
  const factors = distinctPrimeFactors(phi);
  for (let g = 2; g < P; g++) {
    let ok = true;
    for (const f of factors) {
      if (modPow(g, phi / f, P) === 1) {
        ok = false;
        break;
      }
    }
    if (ok) return g;
  }
  return 2;
}

export interface FourierResult {
  real: Float32Array;
  imag: Float32Array;
  samples: number[];
  realA: Float32Array;
  imagA: Float32Array;
  realB: Float32Array;
  imagB: Float32Array;
  realCross: Float32Array;
  imagCross: Float32Array;
  samplesCross: number[];
  /** Operator residue: the components the comb/circulant/Möbius chain removed
   * (pre-operator spectrum minus the level-matched output). final + resid
   * reconstructs the un-operated spectrum exactly. */
  residReal: Float32Array;
  residImag: Float32Array;
  /** A/B composition and projection diagnostics, computed only for the lab or audition. */
  lab?: OperatorLabAnalysis;
}

// Minimal complex-scalar arithmetic for the Möbius matrix power below. Cx = [re, im].
type Cx = [number, number];
const cxAdd = (x: Cx, y: Cx): Cx => [x[0] + y[0], x[1] + y[1]];
const cxSub = (x: Cx, y: Cx): Cx => [x[0] - y[0], x[1] - y[1]];
const cxMul = (x: Cx, y: Cx): Cx => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
const cxScale = (x: Cx, t: number): Cx => [x[0] * t, x[1] * t];
const cxDiv = (x: Cx, y: Cx): Cx => {
  const d = y[0] * y[0] + y[1] * y[1] || 1e-30;
  return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d];
};
const cxSqrt = (x: Cx): Cx => {
  const r = Math.hypot(x[0], x[1]);
  const re = Math.sqrt(Math.max(0, (r + x[0]) / 2));
  let im = Math.sqrt(Math.max(0, (r - x[0]) / 2));
  if (x[1] < 0) im = -im;
  return [re, im];
};
const cxPow = (x: Cx, t: number): Cx => {
  const r = Math.hypot(x[0], x[1]);
  if (r < 1e-30) return [0, 0];
  const e = Math.exp(Math.log(r) * t);
  const arg = Math.atan2(x[1], x[0]) * t;
  return [e * Math.cos(arg), e * Math.sin(arg)];
};

interface MobiusMatrix {
  a: Cx;
  b: Cx;
  c: Cx;
  d: Cx;
}

/**
 * Fractional power Mᵗ of a Möbius matrix M ∈ SL(2,ℂ), via eigendecomposition — the true
 * one-parameter flow e^{t·log M} through M. With eigenvalues λ, 1/λ (det M = 1),
 * Mᵗ = λ⁻ᵗ·I + (λᵗ − λ⁻ᵗ)·P₊, where P₊ = (M − λ⁻¹I)/(λ − λ⁻¹) is the spectral
 * projector. A loxodromic λ = ρe^{iψ} gives λᵗ = ρᵗe^{itψ} — a genuine spiral, which is
 * what the linear frame-chord approximation could not render. The parabolic case
 * (repeated eigenvalue, non-diagonalizable) uses Mᵗ = λ₀ᵗ·(I + t·(λ₀⁻¹M − I)).
 */
function mobiusMatrixPower(m: MobiusMatrix, t: number): MobiusMatrix {
  if (Math.abs(t - 1) < 1e-9) return m;
  if (Math.abs(t) < 1e-9) return { a: [1, 0], b: [0, 0], c: [0, 0], d: [1, 0] };

  const tau = cxAdd(m.a, m.d);
  const disc = cxSub(cxMul(tau, tau), [4, 0]);
  const sq = cxSqrt(disc);

  if (Math.hypot(sq[0], sq[1]) < 1e-6) {
    const lam0 = cxScale(tau, 0.5);
    const lp = cxPow(lam0, t);
    const inv = cxDiv([1, 0], lam0);
    const Ma = cxMul(m.a, inv);
    const Mb = cxMul(m.b, inv);
    const Mc = cxMul(m.c, inv);
    const Md = cxMul(m.d, inv);
    return {
      a: cxMul(lp, cxAdd([1, 0], cxScale(cxSub(Ma, [1, 0]), t))),
      b: cxMul(lp, cxScale(Mb, t)),
      c: cxMul(lp, cxScale(Mc, t)),
      d: cxMul(lp, cxAdd([1, 0], cxScale(cxSub(Md, [1, 0]), t))),
    };
  }

  const lam = cxScale(cxAdd(tau, sq), 0.5);
  const lam2 = cxDiv([1, 0], lam);
  const denom = cxSub(lam, lam2);
  const Pa = cxDiv(cxSub(m.a, lam2), denom);
  const Pb = cxDiv(m.b, denom);
  const Pc = cxDiv(m.c, denom);
  const Pd = cxDiv(cxSub(m.d, lam2), denom);
  const lamt = cxPow(lam, t);
  const laminvt = cxDiv([1, 0], lamt);
  const diff = cxSub(lamt, laminvt);
  return {
    a: cxAdd(laminvt, cxMul(diff, Pa)),
    b: cxMul(diff, Pb),
    c: cxMul(diff, Pc),
    d: cxAdd(laminvt, cxMul(diff, Pd)),
  };
}

/** Product of two Möbius matrices (2×2 complex). */
function cxMatMul(m1: MobiusMatrix, m2: MobiusMatrix): MobiusMatrix {
  return {
    a: cxAdd(cxMul(m1.a, m2.a), cxMul(m1.b, m2.c)),
    b: cxAdd(cxMul(m1.a, m2.b), cxMul(m1.b, m2.d)),
    c: cxAdd(cxMul(m1.c, m2.a), cxMul(m1.d, m2.c)),
    d: cxAdd(cxMul(m1.c, m2.b), cxMul(m1.d, m2.d)),
  };
}

/**
 * The Möbius matrix M = P·T·B·R ∈ SL(2,ℂ) for the given generator amounts (Rotate θ,
 * Boost via s = 2^boost, Tilt φ = tilt·π/2, and parabolic shear β fixing ∞).
 */
function buildMobiusMatrix(
  rotate: number,
  boost: number,
  tilt: number,
  parab: number
): MobiusMatrix {
  const halfTheta = rotate / 2;
  const s = Math.pow(2, boost);
  const halfPhi = (tilt * Math.PI) / 4;
  const cosP = Math.cos(halfPhi);
  const sinP = Math.sin(halfPhi);
  const cosT = Math.cos(halfTheta);
  const sinT = Math.sin(halfTheta);

  const a: Cx = [cosP * s * cosT, cosP * s * sinT];
  let b: Cx = [-sinP * (1 / s) * cosT, sinP * (1 / s) * sinT];
  const c: Cx = [sinP * s * cosT, sinP * s * sinT];
  let d: Cx = [cosP * (1 / s) * cosT, -cosP * (1 / s) * sinT];

  if (Math.abs(parab) > 1e-9) {
    b = [b[0] + a[0] * parab, b[1] + a[1] * parab];
    d = [d[0] + c[0] * parab, d[1] + c[1] * parab];
  }
  return { a, b, c, d };
}

/**
 * Cayley intertwiner: image of the LCT's canonical element g ∈ SL(2,ℝ) on the harmonic
 * disk. g = R(φ)·A(s)·N(c) is the same rotation/squeeze/shear (Iwasawa KAN) that the
 * LCT applies to the cycle's time–frequency plane (φ = frftAngle·π/2, s = 2^squeeze,
 * shear c). The Cayley transform C = (1/√2)[[1,−i],[1,i]] maps the upper half-plane to
 * the unit disk and conjugates the action: L = C·g·C⁻¹ ∈ SU(1,1). Composing L with the
 * Möbius matrix makes a single gesture move the time–frequency plane and the CP¹
 * spectrum as one abstract group element, read in the two representations at once.
 */
function cayleyImage(frftAngle: number, squeeze: number, shear: number): MobiusMatrix {
  const phi = (frftAngle * Math.PI) / 2;
  const rs = Math.sqrt(Math.pow(2, squeeze));
  const irs = 1 / rs;
  const cph = Math.cos(phi);
  const sph = Math.sin(phi);

  // g = R(φ)·A(s)·N(c), a real SL(2,ℝ) matrix (im = 0)
  const G: MobiusMatrix = {
    a: [cph * rs, 0],
    b: [cph * rs * shear - sph * irs, 0],
    c: [sph * rs, 0],
    d: [sph * rs * shear + cph * irs, 0],
  };
  const C: MobiusMatrix = {
    a: [Math.SQRT1_2, 0],
    b: [0, -Math.SQRT1_2],
    c: [Math.SQRT1_2, 0],
    d: [0, Math.SQRT1_2],
  };
  const Cinv: MobiusMatrix = {
    a: [Math.SQRT1_2, 0],
    b: [Math.SQRT1_2, 0],
    c: [0, Math.SQRT1_2],
    d: [0, -Math.SQRT1_2],
  };
  return cxMatMul(cxMatMul(C, G), Cinv);
}

/**
 * Per-note genesis-envelope position — the flow amounts a single coefficient frame is
 * computed at. The updateFrames stage loop samples t ∈ [0,1] and builds one FlowState
 * per stage (via `stageFlow`); the worklet then interpolates between the resulting
 * frames as a note ages. Every field is identity-valued when omitted, so STATIC_FLOW is
 * a no-op and the steady-state spectrum is `computeFourierSeries(p)`.
 *
 * This is the single seam the Section IV flows plug into. Adding one is three edits: add
 * its field here, set it in `stageFlow`, and read it (`flow.x ?? identity`) in its stage
 * inside computeFourierSeries.
 *   • frftMix     — α-envelope fading the LCT/FrFT in from 0 (temporal → spectral).
 *   • mobiusPower — fractional Möbius power Mᵗ along the CP¹ orbit (1 = static).
 *   • thetaT      — §IV.1 theta/Talbot fade (reserved, not yet consumed).
 *   • permPower   — §IV.2 cyclotomic permutation Pᵗ (reserved, not yet consumed).
 *   • operatorT   — §IV.4 operator flow e^{−tH} / e^{−itH} (reserved, not yet consumed).
 */
export interface FlowState {
  mobiusPower: number;
  frftMix?: number;
  thetaT?: number;
  permPower?: number;
  operatorT?: number;
}

/** The identity flow: steady-state spectrum, no genesis animation. */
export const STATIC_FLOW: FlowState = { mobiusPower: 1 };

/** Absolute-Hz focus anchors around middle C when Focus Track is fully engaged. */
const FOCUS_REF_HZ = midiToFreq(60);
const FOCUS_HZ_MIN = 80;
const FOCUS_HZ_MAX = 8000;

/**
 * Shared logarithmic operator window. Width 8 is the backwards-compatible all-pass.
 * Index mode centers on harmonic N^Focus; Hz mode centers on 80 Hz–8 kHz, with
 * Focus Track blending fixed absolute Hz (0) into pitch-scaled bands (1).
 */
function operatorFocusWeight(
  p: SynthParams,
  n: number,
  N: number,
  refFreq: number = FOCUS_REF_HZ
): number {
  if (p.operatorWidth >= 7.95 || N <= 1) return 1;
  let center: number;
  if (p.bandMode >= 0.5) {
    const focusHz = FOCUS_HZ_MIN * Math.pow(FOCUS_HZ_MAX / FOCUS_HZ_MIN, p.operatorFocus);
    const track = Math.max(0, Math.min(1, p.focusTrack));
    const effectiveHz = focusHz * Math.pow(Math.max(20, refFreq) / FOCUS_REF_HZ, track);
    center = Math.max(1, effectiveHz / Math.max(20, refFreq));
  } else {
    center = Math.pow(N, p.operatorFocus);
  }
  const distanceOct = Math.log2(Math.max(1, n) / Math.max(1, center));
  const sigma = Math.max(0.125, p.operatorWidth / 2);
  return Math.exp(-0.5 * Math.pow(distanceOct / sigma, 2));
}

/** Which genesis flows are animated over the note (one flag per nonzero-at-t flow). */
export interface FlowActive {
  alpha?: boolean;
  mobius?: boolean;
  theta?: boolean;
  cyclotomic?: boolean;
}

/**
 * Build the FlowState for genesis stage t ∈ [0,1] from which flows are active. Each
 * active flow runs 0 → t (birth → this stage); inactive flows stay at identity. A new
 * Section IV flow adds a flag to FlowActive and a line here.
 */
export function stageFlow(t: number, active: FlowActive): FlowState {
  return {
    mobiusPower: active.mobius ? t : 1,
    frftMix: active.alpha ? t : undefined,
    thetaT: active.theta ? t : undefined,
    permPower: active.cyclotomic ? t : undefined,
  };
}

export function computeFourierSeries(
  p: SynthParams,
  harmonicsCount: number = p.harmonicsCount,
  flow: FlowState = STATIC_FLOW,
  refFreq: number = FOCUS_REF_HZ,
  includeOperatorLab = false
): FourierResult {
  const K = 512;
  let samples = new Array<number>(K);
  const samplesA = new Array<number>(K);
  const samplesB = new Array<number>(K);

  for (let j = 0; j < K; j++) {
    const theta = (j / K) * 2 * Math.PI;
    samples[j] = evaluateModulatedBentSaw(
      theta,
      p.bendPosition,
      p.bendAmount,
      p.bend2Position,
      p.bend2Amount,
      p.bendAngle,
      p.modIndex,
      p.modRatio
    );
    samplesA[j] = evaluateModulatedSingleBentSaw(
      theta,
      p.bendPosition,
      p.bendAmount,
      p.modIndex,
      p.modRatio
    );
    samplesB[j] = evaluateModulatedSingleBentSaw(
      theta,
      p.bend2Position,
      p.bend2Amount,
      p.modIndex,
      p.modRatio
    );
  }

  // Blend in the arithmetic boundary cycle — the number-as-a-curve oscillator. It joins the
  // fused cycle only; samplesA/samplesB stay the pure A and B bends, so the tensor crossing
  // layer keeps meaning what it means (the product of the two bend spectra). Everything
  // downstream — pivot, LCT, comb, χ, Hecke, theta, cyclotomic, circulant, Möbius, and the
  // unison expander — then operates on the arithmetic waveform for free.
  // The arithmetic curve is also one of the regime split's rule-B sources, so it is built
  // once here and shared rather than recomputed inside the split.
  const regimeOn = p.regimeMix > 0.001;
  const regimeSource = Math.round(p.regimeSource);
  const needsArith = p.arithMix > 0.001 || (regimeOn && regimeSource === 2);
  const arith = needsArith ? arithmeticCycle(p, K) : null;

  if (arith && p.arithMix > 0.001) {
    const mix = Math.min(1, p.arithMix);
    for (let j = 0; j < K; j++) {
      samples[j] = (1 - mix) * samples[j] + mix * arith[j];
    }
  }

  // The pre-projection patch is now a typed operator program. The same nodes are also
  // available to the Operator Laboratory, which can run A∘B, B∘A, and Π commutators
  // without duplicating the implementations used by the audible path.
  const cycleContext: CycleOperatorContext = {
    samplesA,
    samplesB,
    arithmetic: arith,
    harmonicsCount,
    lctMix: flow.frftMix,
  };
  const labEnabled = (p.labEnabled ?? 0) > 0.5;
  const lab =
    includeOperatorLab || labEnabled ? analyzeOperatorLab(samples, cycleContext, p) : undefined;
  samples = labEnabled && lab
    ? lab.results[lab.selected].cycle
    : runPreProjectionProgram(samples, cycleContext, p);

  // Π is a named first-class boundary rather than an inline DFT loop. The three source
  // representations share exactly the same projection semantics.
  const projected = projectCycle(samples, { harmonics: harmonicsCount });
  const projectedA = projectCycle(samplesA, { harmonics: harmonicsCount });
  const projectedB = projectCycle(samplesB, { harmonics: harmonicsCount });
  const { real, imag } = projected;
  const { real: realA, imag: imagA } = projectedA;
  const { real: realB, imag: imagB } = projectedB;

  // Generalized slice of the tensor outer product T_{r,s} = F_A(r)·F_B(s).
  //
  // crossShear k selects the sheared diagonal r = s + k: each harmonic n carries
  // F_A(n+k)·F_B(n) — the B layer multiplied against a spectrally shifted A layer.
  // crossConvolve morphs from that slice to the anti-diagonal sum Σ_{r+s=n} T_{r,s},
  // which is exact spectral convolution: time-domain multiplication (ring modulation)
  // whose sidebands land only on the harmonic grid, so it stays in tune.
  const realCrossRaw = new Float32Array(harmonicsCount + 1);
  const imagCrossRaw = new Float32Array(harmonicsCount + 1);

  // Wronskian / Plücker layer. W = f_A·f_B′ − f_A′·f_B is the Wronskian of the two bend
  // cycles; it vanishes identically iff A and B are projectively proportional, so it is
  // an audible detector of the *disagreement* between the layers (all 2×2 minors of the
  // rank-1 tensor F_A⊗F_B are zero, but the derivative pairing is not). In exponential
  // coefficients c, its harmonics are W_n = i·Σ_{r+s=n} (s − r)·c_A(r)·c_B(s) over signed
  // indices. crossWedge morphs the cross layer toward it.
  const wedge = p.crossWedge;
  const wedgeR = new Float32Array(harmonicsCount + 1);
  const wedgeI = new Float32Array(harmonicsCount + 1);
  if (wedge > 0.001) {
    const N = harmonicsCount;
    for (let n = 1; n <= N; n++) {
      let accRe = 0;
      let accIm = 0;
      for (let r = -N; r <= N; r++) {
        if (r === 0) continue;
        const s = n - r;
        if (s === 0 || s < -N || s > N) continue;
        const ar = Math.abs(r);
        const as = Math.abs(s);
        // Signed exponential coefficient c_X(k): (Xr(|k|) ∓ i·Xi(|k|))/2 for k ≷ 0.
        const aRe = realA[ar] / 2;
        const aIm = (r > 0 ? -imagA[ar] : imagA[ar]) / 2;
        const bRe = realB[as] / 2;
        const bIm = (s > 0 ? -imagB[as] : imagB[as]) / 2;
        const w = s - r;
        accRe += w * (aRe * bRe - aIm * bIm);
        accIm += w * (aRe * bIm + aIm * bRe);
      }
      // ×i, then map c_n back to cos/sin coefficients (Wr = 2·Re, Wi = −2·Im).
      wedgeR[n] = -2 * accIm;
      wedgeI[n] = -2 * accRe;
    }
  }

  // Signed spectral cross-correlation. A separation of k partials becomes harmonic k:
  // C[k] = Σ_n F_A[n+k]·conj(F_B[n]). Unlike the positive-index convolution, this
  // explicitly turns upper spectral relationships into low difference harmonics.
  const difference = p.crossDifference;
  const diffR = new Float32Array(harmonicsCount + 1);
  const diffI = new Float32Array(harmonicsCount + 1);
  if (difference > 0.001) {
    for (let k = 1; k <= harmonicsCount; k++) {
      let accR = 0;
      let accI = 0;
      for (let n = 1; n + k <= harmonicsCount; n++) {
        const ar = realA[n + k];
        const ai = imagA[n + k];
        const br = realB[n];
        const bi = imagB[n];
        accR += ar * br + ai * bi;
        accI += ai * br - ar * bi;
      }
      diffR[k] = accR;
      diffI[k] = accI;
    }
  }

  const shear = Math.round(p.crossShear);
  const conv = p.crossConvolve;
  const cosPh = Math.cos(p.crossPhase);
  const sinPh = Math.sin(p.crossPhase);
  for (let n = 1; n <= harmonicsCount; n++) {
    let rProd = 0;
    let iProd = 0;

    const m = n + shear;
    if (m >= 1 && m <= harmonicsCount) {
      rProd = realA[m] * realB[n] - imagA[m] * imagB[n];
      iProd = realA[m] * imagB[n] + imagA[m] * realB[n];
    }

    if (conv > 0.001) {
      let convR = 0;
      let convI = 0;
      for (let r = 1; r < n; r++) {
        const s = n - r;
        convR += realA[r] * realB[s] - imagA[r] * imagB[s];
        convI += realA[r] * imagB[s] + imagA[r] * realB[s];
      }
      rProd = (1 - conv) * rProd + conv * convR;
      iProd = (1 - conv) * iProd + conv * convI;
    }

    if (wedge > 0.001) {
      rProd = (1 - wedge) * rProd + wedge * wedgeR[n];
      iProd = (1 - wedge) * iProd + wedge * wedgeI[n];
    }

    if (difference > 0.001) {
      rProd = (1 - difference) * rProd + difference * diffR[n];
      iProd = (1 - difference) * iProd + difference * diffI[n];
    }

    realCrossRaw[n] = rProd * cosPh - iProd * sinPh;
    imagCrossRaw[n] = rProd * sinPh + iProd * cosPh;
  }

  // Energy-match the diagonal product layer to the main layer
  let energyMain = 0;
  let energyCross = 0;
  for (let n = 1; n <= harmonicsCount; n++) {
    energyMain += real[n] * real[n] + imag[n] * imag[n];
    energyCross += realCrossRaw[n] * realCrossRaw[n] + imagCrossRaw[n] * imagCrossRaw[n];
  }

  const scale = energyCross > 0 ? Math.sqrt(energyMain / energyCross) : 1.0;

  const realCross = new Float32Array(harmonicsCount + 1);
  const imagCross = new Float32Array(harmonicsCount + 1);
  for (let n = 1; n <= harmonicsCount; n++) {
    realCross[n] = realCrossRaw[n] * scale;
    imagCross[n] = imagCrossRaw[n] * scale;
  }

  // Reconstruct the cross layer's single cycle for display
  const samplesCross = new Array<number>(K);
  for (let j = 0; j < K; j++) {
    const theta = (j / K) * 2 * Math.PI;
    let sum = 0;
    for (let n = 1; n <= harmonicsCount; n++) {
      sum += realCross[n] * Math.cos(n * theta) + imagCross[n] * Math.sin(n * theta);
    }
    samplesCross[j] = sum;
  }

  // Mix main and cross layers
  const finalReal = new Float32Array(harmonicsCount + 1);
  const finalImag = new Float32Array(harmonicsCount + 1);
  for (let n = 1; n <= harmonicsCount; n++) {
    finalReal[n] = (1 - p.crossMix) * real[n] + p.crossMix * realCross[n];
    finalImag[n] = (1 - p.crossMix) * imag[n] + p.crossMix * imagCross[n];
  }

  let energyBeforeFilters = 0;
  for (let n = 1; n <= harmonicsCount; n++) {
    energyBeforeFilters += finalReal[n] * finalReal[n] + finalImag[n] * finalImag[n];
  }

  // Snapshot the pre-operator spectrum so the operators' residue can be extended
  // through time instead of discarded
  const preOpReal = finalReal.slice();
  const preOpImag = finalImag.slice();

  // Filter 1: number-theoretic comb gating (valuation / Collatz)
  if (p.collatzGating > 0.001) {
    for (let n = 1; n <= harmonicsCount; n++) {
      let weight = 1.0;

      if (p.valuationBase === 2) {
        const v = getPAdicValuation(n, 2);
        weight = 0.12 + 0.88 * (v / 7.0);
      } else if (p.valuationBase === 3) {
        const v = getPAdicValuation(n, 3);
        weight = 0.12 + 0.88 * (v / 5.0);
      } else if (p.valuationBase === 7) {
        const steps = getCollatzStoppingTime(n);
        weight = 0.15 + 0.85 * (Math.sin(steps * 0.18) * 0.5 + 0.5);
      } else if (p.valuationBase === 11) {
        const maxVal = getCollatzMax(n);
        weight = 0.15 + 0.85 * (Math.sin(Math.log(maxVal) * 1.4) * 0.5 + 0.5);
      } else if (p.valuationBase === 13) {
        // Congruence sieve: drop every harmonic that shares a prime factor with the
        // modulus M — a structured dropout at the multiples of M's prime factors.
        // e.g. M = 10013 = 17·19·31 notches harmonics 17, 19, 31, 34, 38, 51, 62, …
        const M = Math.max(2, Math.round(p.combModulus));
        weight = gcd(n, M) > 1 ? 0.0 : 1.0;
      }

      const amount = p.collatzGating * operatorFocusWeight(p, n, harmonicsCount, refFreq);
      const blend = (1 - amount) + amount * weight;
      finalReal[n] *= blend;
      finalImag[n] *= blend;
    }
  }

  // Filter 1b: p-adic (Vladimirov) tilt. Scale harmonic n by p^{−s·v_p(n)}, so every n
  // sharing a p-adic valuation shares a gain — a self-similar comb of plateaus, smooth in
  // the p-adic metric though jagged in the Archimedean one. Reuses the comb basis's prime
  // (2- or 3-adic); s > 0 attenuates the p-divisible harmonics, s < 0 boosts them.
  if (Math.abs(p.padicTilt) > 0.001) {
    const prime = p.valuationBase === 3 ? 3 : 2;
    for (let n = 1; n <= harmonicsCount; n++) {
      const g = Math.pow(prime, -p.padicTilt * getPAdicValuation(n, prime));
      const focusedGain = 1 + operatorFocusWeight(p, n, harmonicsCount, refFreq) * (g - 1);
      finalReal[n] *= focusedGain;
      finalImag[n] *= focusedGain;
    }
  }

  // Filter 1c: Dirichlet character twist. Multiply harmonic n by χ_k(n), a unit-modulus
  // per-harmonic phase (with dropouts where q | n) drawn from the character group of
  // (Z/qZ)*. dirichletOrder sweeps k ∈ [0, q−1]: k = 0 is the principal character, and
  // k = (q−1)/2 lands exactly on the real quadratic (Legendre) character — a ± sign
  // pattern that phase-inverts the quadratic non-residues. dirichletTwist is the dry/wet.
  if (p.dirichletTwist > 0.001) {
    const q = Math.max(3, Math.round(p.dirichletModulus));
    const ind = dirichletIndexTable(q);
    const k = p.dirichletOrder * (q - 1);
    const phaseScale = (2 * Math.PI * k) / (q - 1);
    for (let n = 1; n <= harmonicsCount; n++) {
      const twist = p.dirichletTwist * operatorFocusWeight(p, n, harmonicsCount, refFreq);
      const a = n % q;
      let tr: number;
      let ti: number;
      if (a === 0) {
        // q | n: χ(n) = 0 — a structured notch on the multiples of the modulus.
        tr = 0;
        ti = 0;
      } else {
        const theta = phaseScale * ind[a];
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        tr = finalReal[n] * c - finalImag[n] * s;
        ti = finalReal[n] * s + finalImag[n] * c;
      }
      finalReal[n] = (1 - twist) * finalReal[n] + twist * tr;
      finalImag[n] = (1 - twist) * finalImag[n] + twist * ti;
    }
  }

  // Filter 1d: Hecke operator T_p. The one genuinely off-diagonal operator here: it
  // couples each harmonic across scale, (T_p F)(n) = F(pn) + p^{w−1}·F(n/p), summing the
  // p-th multiple (decimation, "zoom out") with the p-th divisor (dilation, "zoom in").
  // heckeWeight is the modular weight w setting the p^{w−1} balance between the two
  // copies; heckeMix is the dry/wet. Reads a snapshot so the coupling stays simultaneous.
  if (p.heckeMix > 0.001) {
    const pr = Math.max(2, Math.round(p.heckePrime));
    const dilGain = Math.pow(pr, p.heckeWeight - 1);
    const srcR = finalReal.slice();
    const srcI = finalImag.slice();
    for (let n = 1; n <= harmonicsCount; n++) {
      const mix = p.heckeMix * operatorFocusWeight(p, n, harmonicsCount, refFreq);
      let hr = 0;
      let hi = 0;
      const pn = pr * n;
      if (pn <= harmonicsCount) {
        hr += srcR[pn];
        hi += srcI[pn];
      }
      if (n % pr === 0) {
        const nd = n / pr;
        hr += dilGain * srcR[nd];
        hi += dilGain * srcI[nd];
      }
      finalReal[n] = (1 - mix) * srcR[n] + mix * hr;
      finalImag[n] = (1 - mix) * srcI[n] + mix * hi;
    }
  }

  // Filter 1e: theta / Talbot — quadratic phase in the harmonic index. Multiply every
  // harmonic by e^{iπτn²} with τ = σ + iη (θ Phase, θ Heat): the frequency-domain dual
  // of the LCT stage's time-domain chirp. It is diagonal, so it commutes with the other
  // per-harmonic multipliers (comb / p-adic / Dirichlet) and sits with them, ahead of the
  // coupling operators (circulant / Möbius) that act on the shaped spectrum.
  //
  //   • Phase σ uses the *integer* n² — that lattice is what makes rational σ = p/q
  //     self-image the waveform (fractional Talbot revivals; e.g. σ=1 gives (−1)ⁿ, a
  //     half-period shift). σ irrational scrambles quasi-periodically.
  //   • Heat η is a real Gaussian gain e^{−6η(n/N)²}, normalized by the harmonic count so
  //     the rolloff-toward-a-sine reads the same at any N.
  //
  // flow.thetaT (§IV.1) blooms τ in from 0 over the per-note genesis envelope; undefined
  // (the steady state) means full static τ.
  if (Math.abs(p.thetaPhase) > 1e-4 || p.thetaHeat > 1e-4) {
    const tScale = flow.thetaT ?? 1;
    const sigma = p.thetaPhase * tScale;
    const heatK = 6 * p.thetaHeat * tScale;
    const invN2 = 1 / (harmonicsCount * harmonicsCount);
    for (let n = 1; n <= harmonicsCount; n++) {
      const focus = operatorFocusWeight(p, n, harmonicsCount, refFreq);
      const n2 = n * n;
      const phase = Math.PI * sigma * n2;
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      const gain = heatK > 0 ? Math.exp(-heatK * n2 * invN2) : 1;
      const r = finalReal[n];
      const im = finalImag[n];
      const tr = (r * c - im * s) * gain;
      const ti = (r * s + im * c) * gain;
      finalReal[n] = r + focus * (tr - r);
      finalImag[n] = im + focus * (ti - im);
    }
  }

  // Filter 1f: cyclotomic / Galois permutation of the partials. Reindex the harmonics by
  // the multiplicative action n ↦ mult·n (mod P) on the cyclic group (Z/PZ)*, with P the
  // largest prime ≤ N — a rigid arithmetic "anagram" of the spectrum: the amplitude
  // multiset is preserved but the partials are shuffled by a number-theoretic rule, not
  // randomness. Harmonics ≥ P are left fixed (P−1 < N covers all but the top few).
  //
  //   • action "spread" uses a primitive root g (one big (P−1)-cycle — maximal scramble);
  //     "mirror" uses −1 ≡ P−1 (order 2 — swaps each n ↔ P−n).
  //   • The permutation decomposes into disjoint cycles, and its true fractional power Pᵗ
  //     is a per-cycle DFT with a phase advance (the same eigen-move as mobiusMatrixPower):
  //     t slides the partials continuously along their orbit cycles from identity (t=0) to
  //     the full permutation (t=1), phase-braiding within each cycle in between. Unitary,
  //     so energy is preserved at every t.
  //   • cyclotomicMix is the dry/wet; flow.permPower (§IV.2) blooms t over the genesis
  //     envelope (undefined → the full static t).
  if (p.cyclotomicMix > 0.001) {
    const N = harmonicsCount;
    const P = largestPrimeLE(N);
    if (P >= 3) {
      const mult = p.cyclotomicAction === 1 ? P - 1 : leastPrimitiveRoot(P);
      const t = p.cyclotomicPower * (flow.permPower ?? 1);
      const permR = finalReal.slice();
      const permI = finalImag.slice();
      const visited = new Uint8Array(P);

      for (let start = 1; start < P; start++) {
        if (visited[start]) continue;
        const cyc: number[] = [];
        let m = start;
        while (!visited[m]) {
          visited[m] = 1;
          cyc.push(m);
          m = (mult * m) % P;
        }
        const L = cyc.length;
        if (L < 2) continue; // fixed point

        // DFT of the complex coefficient sequence around the cycle: Xₘ = Σⱼ xⱼ e^{−2πimj/L}.
        const Xr = new Float64Array(L);
        const Xi = new Float64Array(L);
        for (let k = 0; k < L; k++) {
          let sr = 0;
          let si = 0;
          for (let j = 0; j < L; j++) {
            const nj = cyc[j];
            const ang = (-2 * Math.PI * k * j) / L;
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            const fr = finalReal[nj];
            const fi = finalImag[nj];
            sr += fr * c - fi * s;
            si += fr * s + fi * c;
          }
          Xr[k] = sr;
          Xi[k] = si;
        }
        // Inverse DFT with a fractional index shift of t: yₖ = (1/L) Σₘ Xₘ e^{2πim(k−t)/L}.
        // t=0 → identity; t=1 → yₖ = x_{k−1}, i.e. new[cyc[k]] = old[cyc[k−1]] (the exact
        // forward permutation). Non-integer t interpolates unitarily.
        for (let k = 0; k < L; k++) {
          let ar = 0;
          let ai = 0;
          for (let mm = 0; mm < L; mm++) {
            const ang = (2 * Math.PI * mm * (k - t)) / L;
            const c = Math.cos(ang);
            const s = Math.sin(ang);
            ar += Xr[mm] * c - Xi[mm] * s;
            ai += Xr[mm] * s + Xi[mm] * c;
          }
          permR[cyc[k]] = ar / L;
          permI[cyc[k]] = ai / L;
        }
      }

      for (let n = 1; n <= N; n++) {
        const mix = p.cyclotomicMix * operatorFocusWeight(p, n, N, refFreq);
        finalReal[n] = (1 - mix) * finalReal[n] + mix * permR[n];
        finalImag[n] = (1 - mix) * finalImag[n] + mix * permI[n];
      }
    }
  }

  // Filter 2: circulant operator with eigenline phase rotation
  if (p.circulantOperatorStrength > 0.001) {
    const centerHarmonic = 1 + p.circulantKernelShift * harmonicsCount;
    const width = Math.max(1.8, harmonicsCount * 0.18);

    for (let n = 1; n <= harmonicsCount; n++) {
      const strength =
        p.circulantOperatorStrength * operatorFocusWeight(p, n, harmonicsCount, refFreq);
      const kernelAmp =
        0.04 + 0.96 * Math.exp(-0.5 * Math.pow((n - centerHarmonic) / width, 2));

      const rotAngle = n * p.circulantKernelShift * Math.PI;
      const cosRot = Math.cos(rotAngle);
      const sinRot = Math.sin(rotAngle);

      const rOrig = finalReal[n];
      const iOrig = finalImag[n];
      const rFiltered = (rOrig * cosRot - iOrig * sinRot) * kernelAmp;
      const iFiltered = (rOrig * sinRot + iOrig * cosRot) * kernelAmp;

      finalReal[n] =
        (1 - strength) * rOrig +
        strength * rFiltered;
      finalImag[n] =
        (1 - strength) * iOrig +
        strength * iFiltered;
    }
  }

  // Filter 3: Möbius transformation of CP¹.
  //
  // Each harmonic's projective coordinate w_n = F(n)/F(1) is pushed through
  // w ↦ (a·w + b)/(c·w + d) with M = Parabolic·Tilt·Boost·Rotate ∈ SL(2,C), then pulled
  // back to coefficients via F'(n) = w'_n·F(1). The four generators exhaust the SL(2,C)
  // conjugacy classes: Rotate is elliptic about the 0–∞ axis (constant phase advance per
  // harmonic ratio), Boost is hyperbolic along that axis (spectral tilt toward dark or
  // bright), Tilt is elliptic about a horizontal axis (mixes 0 with ∞, pushing quiet
  // harmonics into audibility), and Parabolic is the single-fixed-point shear w ↦ w + β
  // (fixing ∞) that adds a β·F(1) copy of the fundamental into every partial. F(1) is
  // fixed, so the fundamental anchors the transform.
  const cayleyLink = p.cayleyLink === 1;
  if (
    Math.abs(p.mobiusRotate) > 0.001 ||
    Math.abs(p.mobiusBoost) > 0.001 ||
    Math.abs(p.mobiusTilt) > 0.001 ||
    Math.abs(p.mobiusParabolic) > 0.001 ||
    flow.mobiusPower !== 1 ||
    cayleyLink
  ) {
    // M = P·T·B·R ∈ SL(2,C) from the four generator knobs.
    let M = buildMobiusMatrix(
      p.mobiusRotate,
      p.mobiusBoost,
      p.mobiusTilt,
      p.mobiusParabolic
    );

    // Möbius flow: replace M with its true fractional power Mᵗ, so a note traversing
    // t = 0 → 1 follows the one-parameter orbit (spiral for loxodromic M) rather than a
    // straight chord. mobiusPower = 1 leaves the static transform untouched.
    if (flow.mobiusPower !== 1) M = mobiusMatrixPower(M, flow.mobiusPower);

    // Cayley intertwiner: right-compose the Cayley image of the LCT's canonical element
    // (the same rotation/squeeze/shear the FrFT stage applies to the cycle), so the
    // time–frequency and CP¹ pictures move together as one group element.
    if (cayleyLink) {
      M = cxMatMul(M, cayleyImage(p.frftAngle, p.frftSqueeze, p.frftShear));
    }

    const aRe = M.a[0];
    const aIm = M.a[1];
    const bRe = M.b[0];
    const bIm = M.b[1];
    const cRe = M.c[0];
    const cIm = M.c[1];
    const dRe = M.d[0];
    const dIm = M.d[1];

    const f1Re = finalReal[1];
    const f1Im = finalImag[1];
    const f1Mag2 = f1Re * f1Re + f1Im * f1Im;

    if (f1Mag2 > 1e-12) {
      const MAX_W = 16; // cap a ratio so no single harmonic can swallow the spectrum

      for (let n = 2; n <= harmonicsCount; n++) {
        const origR = finalReal[n];
        const origI = finalImag[n];
        // w = F(n)/F(1)
        const wRe = (finalReal[n] * f1Re + finalImag[n] * f1Im) / f1Mag2;
        const wIm = (finalImag[n] * f1Re - finalReal[n] * f1Im) / f1Mag2;

        // num = a·w + b, den = c·w + d
        const numRe = aRe * wRe - aIm * wIm + bRe;
        const numIm = aRe * wIm + aIm * wRe + bIm;
        const denRe = cRe * wRe - cIm * wIm + dRe;
        const denIm = cRe * wIm + cIm * wRe + dIm;

        const denMag2 = denRe * denRe + denIm * denIm;
        let wpRe: number;
        let wpIm: number;
        if (denMag2 < 1e-9) {
          // w maps to the pole: clamp along the numerator direction
          const numMag = Math.sqrt(numRe * numRe + numIm * numIm) || 1;
          wpRe = (numRe / numMag) * MAX_W;
          wpIm = (numIm / numMag) * MAX_W;
        } else {
          wpRe = (numRe * denRe + numIm * denIm) / denMag2;
          wpIm = (numIm * denRe - numRe * denIm) / denMag2;
          const wpMag = Math.sqrt(wpRe * wpRe + wpIm * wpIm);
          if (wpMag > MAX_W) {
            wpRe = (wpRe / wpMag) * MAX_W;
            wpIm = (wpIm / wpMag) * MAX_W;
          }
        }

        // F'(n) = w'·F(1)
        const tr = wpRe * f1Re - wpIm * f1Im;
        const ti = wpRe * f1Im + wpIm * f1Re;
        const focus = operatorFocusWeight(p, n, harmonicsCount, refFreq);
        finalReal[n] = origR + focus * (tr - origR);
        finalImag[n] = origI + focus * (ti - origI);
      }
    }
  }

  // Filter 4: Veronese / power map on CP¹. Each harmonic's projective coordinate
  // w_n = F(n)/F(1) is raised to a power, w ↦ w^d, then pulled back via F'(n) = w^d·F(1).
  // Unlike the Möbius automorphism (degree 1), this is a degree-d endomorphism: integer d
  // pushes harmonic content outward like a Chebyshev/harmonic-multiplication map, while
  // fractional d interpolates. F(1) is held fixed, anchoring the fundamental.
  if (Math.abs(p.harmonicExponent - 1) > 0.001) {
    const d = p.harmonicExponent;
    const f1Re = finalReal[1];
    const f1Im = finalImag[1];
    const f1Mag2 = f1Re * f1Re + f1Im * f1Im;

    if (f1Mag2 > 1e-12) {
      const MAX_W = 16; // same ratio cap as the Möbius stage

      for (let n = 2; n <= harmonicsCount; n++) {
        const origR = finalReal[n];
        const origI = finalImag[n];
        const wRe = (finalReal[n] * f1Re + finalImag[n] * f1Im) / f1Mag2;
        const wIm = (finalImag[n] * f1Re - finalReal[n] * f1Im) / f1Mag2;
        const mag = Math.hypot(wRe, wIm);
        if (mag < 1e-9) {
          const focus = operatorFocusWeight(p, n, harmonicsCount, refFreq);
          finalReal[n] = origR * (1 - focus);
          finalImag[n] = origI * (1 - focus);
          continue;
        }

        // w^d via polar form (principal branch)
        const e = Math.exp(Math.log(mag) * d);
        const arg = Math.atan2(wIm, wRe) * d;
        let wpRe = e * Math.cos(arg);
        let wpIm = e * Math.sin(arg);

        const wpMag = Math.hypot(wpRe, wpIm);
        if (wpMag > MAX_W) {
          wpRe = (wpRe / wpMag) * MAX_W;
          wpIm = (wpIm / wpMag) * MAX_W;
        }

        const tr = wpRe * f1Re - wpIm * f1Im;
        const ti = wpRe * f1Im + wpIm * f1Re;
        const focus = operatorFocusWeight(p, n, harmonicsCount, refFreq);
        finalReal[n] = origR + focus * (tr - origR);
        finalImag[n] = origI + focus * (ti - origI);
      }
    }
  }

  // Normalized low coupling: fold high-band spectral content into harmonics 2..8 so
  // upper-operator / upper-partial motion interferes with the bass body. Prefer the
  // operator delta (final − preOp); when Focus leaves the highs nearly dry, fall back
  // to folding the absolute high band so the control still thickens low notes. The
  // fundamental stays pitch-anchored; a golden-angle phase rotation keeps the fold
  // from collapsing into a single coherent spike.
  if (p.lowCouple > 0.001 && harmonicsCount > 8) {
    const lowMax = Math.min(8, harmonicsCount);
    const foldR = new Float64Array(lowMax + 1);
    const foldI = new Float64Array(lowMax + 1);
    let deltaEnergy = 0;
    let highEnergy = 0;
    for (let n = lowMax + 1; n <= harmonicsCount; n++) {
      const pr = preOpReal[n];
      const pi = preOpImag[n];
      const dr = finalReal[n] - pr;
      const di = finalImag[n] - pi;
      deltaEnergy += dr * dr + di * di;
      highEnergy += finalReal[n] * finalReal[n] + finalImag[n] * finalImag[n];
    }
    // If operators barely moved the highs (e.g. Focus parked on the lows), couple the
    // absolute high band instead so Low Couple still audibly reshapes the body.
    const useAbsolute = deltaEnergy < 0.05 * highEnergy;
    let sourceEnergy = 0;
    for (let n = lowMax + 1; n <= harmonicsCount; n++) {
      const sr = useAbsolute ? finalReal[n] : finalReal[n] - preOpReal[n];
      const si = useAbsolute ? finalImag[n] : finalImag[n] - preOpImag[n];
      sourceEnergy += sr * sr + si * si;
      const k = 2 + ((n - lowMax - 1) % (lowMax - 1));
      const phase = n * 2.399963229728653; // golden angle
      const c = Math.cos(phase);
      const s = Math.sin(phase);
      foldR[k] += sr * c - si * s;
      foldI[k] += sr * s + si * c;
    }
    let foldEnergy = 0;
    for (let n = 2; n <= lowMax; n++) {
      foldEnergy += foldR[n] * foldR[n] + foldI[n] * foldI[n];
    }
    if (sourceEnergy > 1e-12 && foldEnergy > 1e-12) {
      const scale = p.lowCouple * Math.sqrt(sourceEnergy / foldEnergy);
      for (let n = 2; n <= lowMax; n++) {
        finalReal[n] += foldR[n] * scale;
        finalImag[n] += foldI[n] * scale;
      }
    }
  }

  // Spectral quotient downfold: wrap every partial onto the period-K residue classes
  // n ↦ 1 + ((n−1) mod K). High harmonics pile into the low body while the wet path
  // zeros bins above K — a pitch-locked alias that thickens dark notes without a
  // separate oscillator.
  if (p.spectralFold > 0.001 && harmonicsCount > 2) {
    const K = Math.max(2, Math.min(16, Math.round(p.foldPeriod)));
    const foldR = new Float64Array(K + 1);
    const foldI = new Float64Array(K + 1);
    for (let n = 1; n <= harmonicsCount; n++) {
      const dest = 1 + ((n - 1) % K);
      foldR[dest] += finalReal[n];
      foldI[dest] += finalImag[n];
    }
    const w = Math.max(0, Math.min(1, p.spectralFold));
    for (let n = 1; n <= harmonicsCount; n++) {
      const wetR = n <= K ? foldR[n] : 0;
      const wetI = n <= K ? foldI[n] : 0;
      finalReal[n] = finalReal[n] * (1 - w) + wetR * w;
      finalImag[n] = finalImag[n] * (1 - w) + wetI * w;
    }
  }

  // Pitch-locked nonlinear interference: 2nd-order sum and difference products of the
  // strongest partials. Because products land on the same harmonic grid, they read as
  // timbre grit / growl rather than inharmonic clang — especially useful when the dry
  // spectrum is already dark and sparse in the highs.
  if (p.interfere > 0.001 && harmonicsCount > 2) {
    const M = Math.min(harmonicsCount, 24);
    const prodR = new Float64Array(harmonicsCount + 1);
    const prodI = new Float64Array(harmonicsCount + 1);
    let dryE = 0;
    for (let n = 1; n <= harmonicsCount; n++) {
      dryE += finalReal[n] * finalReal[n] + finalImag[n] * finalImag[n];
    }
    for (let i = 1; i <= M; i++) {
      const ari = finalReal[i];
      const aii = finalImag[i];
      if (ari * ari + aii * aii < 1e-16) continue;
      for (let j = i; j <= M; j++) {
        const br = finalReal[j];
        const bi = finalImag[j];
        if (br * br + bi * bi < 1e-16) continue;
        // Sum tone: F(i)·F(j) → harmonic i+j
        const sum = i + j;
        if (sum <= harmonicsCount) {
          prodR[sum] += ari * br - aii * bi;
          prodI[sum] += ari * bi + aii * br;
        }
        // Difference tone: F(i)·conj(F(j)) → harmonic |i−j|
        const diff = Math.abs(i - j);
        if (diff >= 1 && diff <= harmonicsCount) {
          prodR[diff] += ari * br + aii * bi;
          prodI[diff] += aii * br - ari * bi;
        }
      }
    }
    let prodE = 0;
    for (let n = 1; n <= harmonicsCount; n++) {
      prodE += prodR[n] * prodR[n] + prodI[n] * prodI[n];
    }
    if (dryE > 1e-12 && prodE > 1e-12) {
      const w = Math.max(0, Math.min(1, p.interfere));
      const scale = Math.sqrt(dryE / prodE);
      for (let n = 1; n <= harmonicsCount; n++) {
        finalReal[n] = finalReal[n] * (1 - w) + prodR[n] * scale * w;
        finalImag[n] = finalImag[n] * (1 - w) + prodI[n] * scale * w;
      }
    }
  }

  // Match post-filter energy back to pre-filter level
  let energyAfterFilters = 0;
  for (let n = 1; n <= harmonicsCount; n++) {
    energyAfterFilters += finalReal[n] * finalReal[n] + finalImag[n] * finalImag[n];
  }

  if (energyAfterFilters > 0 && energyBeforeFilters > 0) {
    const postScale = Math.sqrt(energyBeforeFilters / energyAfterFilters);
    for (let n = 1; n <= harmonicsCount; n++) {
      finalReal[n] *= postScale;
      finalImag[n] *= postScale;
    }
  }

  // Residue = pre-operator spectrum − level-matched output. Because the level
  // matcher equalizes the energies of the two, both endpoints of the temporal
  // extension (raw ↔ operated) are equally loud by construction.
  const residReal = new Float32Array(harmonicsCount + 1);
  const residImag = new Float32Array(harmonicsCount + 1);
  for (let n = 1; n <= harmonicsCount; n++) {
    residReal[n] = preOpReal[n] - finalReal[n];
    residImag[n] = preOpImag[n] - finalImag[n];
  }

  return {
    real: finalReal,
    imag: finalImag,
    samples,
    realA,
    imagA,
    realB,
    imagB,
    realCross,
    imagCross,
    samplesCross,
    residReal,
    residImag,
    lab,
  };
}

// ── Unison expander ────────────────────────────────────────────────────────────────────
//
// A unison stack used to be one spectrum copied `unisonVoices` times, separated only by
// detune (cents) and pan: the voices beat against each other but share a timbre, so wide
// unison mostly reads as phasing. The expander gives slot i a weight w ∈ [−1, 1] and
// spends that weight displacing a few of the advanced spectral modules for that voice
// alone, so the stack becomes a chord of related timbres.
//
// The weight is fixed at note-on (like detune and pan) and stored on the voice, so held
// notes keep their spectral identity when other parameters move.
//
// Cost: a divergent slot needs its own coefficient frames, so a rebuild while notes are
// held costs one `buildCoefficientFrames` per *distinct* weight (~2 ms per stage at N=96)
// instead of one for the pool. Voices sharing a weight share the frames, so the bill scales
// with the stack size and not with polyphony — except in Hz band mode, where it is per
// (pitch bucket × weight), the same way `pitchFrames` already is. It lands on the main
// thread, not the audio thread: the worklets keep rendering their current frames until the
// new ones arrive. Idle expander = the single shared message, exactly as before.

const GOLDEN_FRAC = 0.6180339887498949;

/**
 * Divergence weights for a stack of `n` voices, one per slot, in [−1, 1].
 *   • profile 0 "ramp"    — w rises with the slot, so it tracks the detune/pan spread:
 *     the flattest voice is also the leftmost. An odd stack keeps its center voice at
 *     w = 0, i.e. exactly the patch spectrum, as an anchor.
 *   • profile 1 "pair"    — sign alternates while magnitude grows outward, so voices that
 *     sit next to each other in pitch and pan are the ones furthest apart in timbre.
 *   • profile 2 "scatter" — golden-ratio low-discrepancy sequence: deterministic, evenly
 *     covering, and uncorrelated with pan, so no voice is the "center" one.
 */
export function unisonWeights(n: number, profile: number): number[] {
  const count = Math.max(1, Math.round(n));
  if (count === 1) return [0];
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    if (profile >= 1.5) {
      out[i] = 2 * (((i + 1) * GOLDEN_FRAC + 0.5) % 1) - 1;
    } else if (profile >= 0.5) {
      const rank = Math.floor(i / 2) + 1;
      const span = Math.ceil(count / 2);
      out[i] = (i % 2 === 0 ? -1 : 1) * (rank / span);
    } else {
      out[i] = (i / (count - 1)) * 2 - 1;
    }
  }
  return out;
}

/**
 * Place weight w ∈ [−1, 1] inside a bounded parameter's range: the stack covers a window
 * of half-width `delta` centered on the patch value, and the window *slides* inside the
 * rails rather than clamping when the patch value already sits on one. Monotone and
 * injective in w, so no two voices can collapse onto the same value — which clamping (and
 * a symmetric fold) both do for a parameter parked at a rail, exactly where the defaults
 * put Orbit t (1) and Focus (0). The cost is that near a rail w = 0 is the middle of the
 * window rather than the patch value itself; away from the rails it is the patch value.
 */
function spreadRange(
  value: number,
  w: number,
  delta: number,
  lo: number,
  hi: number
): number {
  const half = Math.min(delta, (hi - lo) / 2);
  let low = value - half;
  let high = value + half;
  if (low < lo) {
    high += lo - low;
    low = lo;
  }
  if (high > hi) {
    low -= high - hi;
    high = hi;
  }
  low = Math.max(lo, low);
  high = Math.min(hi, high);
  return low + ((Math.max(-1, Math.min(1, w)) + 1) / 2) * (high - low);
}

/** Wrap v into [0, period) — for the parameters that are genuinely periodic. */
function wrapRange(v: number, period: number): number {
  return ((v % period) + period) % period;
}

/** True when the expander would actually displace anything. */
export function expanderActive(p: SynthParams): boolean {
  return (
    p.expandAmount > 0.001 &&
    (p.expandTheta > 0.001 ||
      p.expandOrbit > 0.001 ||
      p.expandTilt > 0.001 ||
      p.expandFocus > 0.001 ||
      p.expandAlpha > 0.001 ||
      p.expandRegime > 0.001)
  );
}

/**
 * The parameter set one unison voice is computed at: the patch displaced along five
 * advanced-module axes in proportion to that voice's weight.
 *
 * The axes were picked so each reaches a different module family, and so a displacement
 * changes colour without moving pitch:
 *   • θ Phase   — a pure phase rotation e^{iπσn²} per harmonic. The amplitude spectrum is
 *     untouched, so voices differ in waveform/crest factor at identical brightness; the
 *     only axis that is audible with its own module parked at zero.
 *   • Orbit t   — position along the cyclotomic permutation's orbit, so voices emphasize
 *     different partials of the same amplitude multiset (needs cyclotomicMix > 0).
 *   • Boost     — the hyperbolic Möbius flow, a spectral tilt: dark → bright across the
 *     stack. Also self-contained.
 *   • Focus     — the shared operator window's center, which every operator in the
 *     comb/χ/Hecke/circulant/Möbius chain reads, so one knob splits the whole family
 *     across bands (needs operatorWidth below its all-pass rail).
 *   • α Angle   — the LCT/FrFT rotation of the cycle's time-frequency plane (needs
 *     frftMix > 0).
 *   • Offset    — the regime window's position, so each voice breaks into the second rule
 *     at a different point of the wave: the stack becomes a graded ensemble crossing over
 *     one voice at a time instead of switching in lockstep (needs regimeMix > 0).
 * The periodic axes (σ mod 2, α mod 4) take a plain signed offset and wrap. The bounded
 * ones spread across a window that slides inside their rails, so they stay usable — and
 * stay injective in w — even with the patch value parked at a rail.
 */
export function divergeParams(p: SynthParams, weight: number): SynthParams {
  if (!expanderActive(p)) return p;
  const amount = p.expandAmount;
  const out = { ...p };
  if (p.expandTheta > 0.001) {
    out.thetaPhase = wrapRange(p.thetaPhase + weight * amount * p.expandTheta * 0.5, 2);
  }
  if (p.expandOrbit > 0.001) {
    out.cyclotomicPower = spreadRange(
      p.cyclotomicPower,
      weight,
      amount * p.expandOrbit * 0.5,
      0,
      1
    );
  }
  if (p.expandTilt > 0.001) {
    out.mobiusBoost = spreadRange(p.mobiusBoost, weight, amount * p.expandTilt * 0.4, -1, 1);
  }
  if (p.expandFocus > 0.001) {
    out.operatorFocus = spreadRange(
      p.operatorFocus,
      weight,
      amount * p.expandFocus * 0.3,
      0,
      1
    );
  }
  if (p.expandAlpha > 0.001) {
    out.frftAngle = wrapRange(p.frftAngle + weight * amount * p.expandAlpha * 0.4, 4);
  }
  if (p.expandRegime > 0.001) {
    out.regimeAsym = spreadRange(p.regimeAsym, weight, amount * p.expandRegime * 0.5, -1, 1);
  }
  // Return the patch itself when this weight landed on it — the sliding window means
  // weight 0 is not automatically the identity, so identity is detected, not assumed.
  // Callers use `=== p` to route the voice to the shared frames.
  const moved =
    out.thetaPhase !== p.thetaPhase ||
    out.cyclotomicPower !== p.cyclotomicPower ||
    out.mobiusBoost !== p.mobiusBoost ||
    out.operatorFocus !== p.operatorFocus ||
    out.frftAngle !== p.frftAngle ||
    out.regimeAsym !== p.regimeAsym;
  return moved ? out : p;
}

/** Parameter displacement used as the spectral-motion morph target (frame B). */
function morphTargetParams(p: SynthParams): SynthParams {
  return {
    ...p,
    bendPosition: Math.min(0.95, Math.max(0.05, p.bendPosition + 0.12)),
    circulantKernelShift: (p.circulantKernelShift + 0.35) % 1,
    crossPhase: (p.crossPhase + Math.PI / 2) % (2 * Math.PI),
    mobiusRotate: (p.mobiusRotate + Math.PI / 2) % (2 * Math.PI),
  };
}

/** Peak amplitude of the cycle a coefficient frame reconstructs (for normalization). */
function framePeak(real: Float32Array, imag: Float32Array): number {
  const P = 128;
  let max = 0;
  for (let j = 0; j < P; j++) {
    const theta = (j / P) * 2 * Math.PI;
    let sum = 0;
    for (let n = 1; n < real.length; n++) {
      sum += real[n] * Math.cos(n * theta) + imag[n] * Math.sin(n * theta);
    }
    const abs = Math.abs(sum);
    if (abs > max) max = abs;
  }
  return max;
}

interface CoefficientFrames {
  aR: Float32Array;
  aI: Float32Array;
  bR: Float32Array;
  bI: Float32Array;
  resR: Float32Array;
  resI: Float32Array;
  // Genesis-envelope stages, ordered birth → settled. The worklet traverses them
  // piecewise-linearly as a note ages. Two frames is a straight α-sweep / chord; more
  // frames trace the Möbius orbit (Mᵗ sampled along t ∈ [0,1]) so loxodromic spirals.
  stagesR: Float32Array[];
  stagesI: Float32Array[];
  // True when a genesis flow animates these frames, so the worklet must open the
  // stage morph even with the α-envelope depth at zero. It lives on the frames rather
  // than on the engine because unison voices are computed at displaced parameters and
  // can differ in whether a flow is engaged at all.
  flowActive: boolean;
  // True when the stages are an arithmetic number sequence, which also opens the morph —
  // and, in envelope mode, hands the traversal clock to the amplitude envelope.
  seqActive: boolean;
}

interface AudioVoice {
  note: number;
  nodes: AudioWorkletNode[];
  gains: GainNode[];
  spatialL: GainNode[];
  spatialR: GainNode[];
  mergers: ChannelMergerNode[];
  azimuths: number[];
  /** Expander divergence weight per slot, fixed at note-on alongside detune and pan. */
  weights: number[];
  /** Per-voice lowpass carrying the filter envelope. */
  filter: BiquadFilterNode;
  sub?: OscillatorNode;
  subGain?: GainNode;
  noise?: AudioBufferSourceNode;
  noiseGain?: GainNode;
  voiceGain: GainNode;
  triggerTime: number;
  releaseTime?: number;
  dead?: boolean;
}

/** Parameters that determine the static spectrum computed by computeFourierSeries. */
export const WAVE_KEYS: (keyof SynthParams)[] = [
  'bendPosition',
  'bendAmount',
  'bend2Position',
  'bend2Amount',
  'bendAngle',
  'arithMix',
  'arithValue',
  'arithBits',
  'arithDecay',
  'arithSwell',
  'arithMap',
  'arithWarp',
  'arithAngle',
  'arithExtract',
  'arithSeqCount',
  'arithValue2',
  'arithValue3',
  'arithValue4',
  'arithMorph',
  'arithMorphMode',
  'arithCoeffMode',
  'arithD1', 'arithD2', 'arithD3', 'arithD4', 'arithD5', 'arithD6', 'arithD7', 'arithD8',
  'arithE1', 'arithE2', 'arithE3', 'arithE4', 'arithE5', 'arithE6', 'arithE7', 'arithE8',
  'crossMix',
  'crossPhase',
  'crossShear',
  'crossConvolve',
  'crossWedge',
  'crossDifference',
  'modIndex',
  'modRatio',
  'harmonicsCount',
  'circulantKernelShift',
  'circulantOperatorStrength',
  'collatzGating',
  'valuationBase',
  'combModulus',
  'padicTilt',
  'dirichletTwist',
  'dirichletOrder',
  'dirichletModulus',
  'heckeMix',
  'heckeWeight',
  'heckePrime',
  'thetaPhase',
  'thetaHeat',
  'cyclotomicMix',
  'cyclotomicPower',
  'cyclotomicAction',
  'operatorFocus',
  'operatorWidth',
  'lowCouple',
  'bandMode',
  'focusTrack',
  'spectralFold',
  'foldPeriod',
  'interfere',
  'regimeMix',
  'regimeThreshold',
  'regimeAsym',
  'regimeRail',
  'regimeOffsetUp',
  'regimeOffsetDn',
  'regimeKnee',
  'regimeSource',
  'labEnabled',
  'labOperatorA',
  'labOperatorB',
  'labResult',
  'zeroStretch',
  'zeroInsert',
  'frftAngle',
  'frftSqueeze',
  'frftShear',
  'frftMix',
  'mobiusRotate',
  'mobiusBoost',
  'mobiusTilt',
  'mobiusParabolic',
  'cayleyLink',
  'harmonicExponent',
];

/** Stable stamp of the wave-relevant parameters — handy as a single memo dependency. */
export function waveStamp(p: SynthParams): string {
  return WAVE_KEYS.map((k) => p[k]).join('|');
}

// Parameters whose change requires re-posting coefficient frames to the worklet
const FRAME_KEYS: (keyof SynthParams)[] = [
  ...WAVE_KEYS,
  'motionRate',
  'motionDepth',
  'extendMix',
  'extendTime',
  'extendSkew',
  'extendBloom',
  'alphaEnvDepth',
  'alphaEnvTime',
  'alphaEnvMode',
  'mobiusFlow',
  'thetaFlow',
  'cyclotomicFlow',
  'arithSeqMode',
  // The expander re-derives one frame set per occupied unison slot. `expandProfile` is
  // absent on purpose: it decides the weights, which are frozen at note-on.
  'expandAmount',
  'expandTheta',
  'expandOrbit',
  'expandTilt',
  'expandFocus',
  'expandAlpha',
  'expandRegime',
];

// Envelope times: they shape the amp envelope on the audio graph (applied per note-on), and
// they also clock the arithmetic sequence's stage traversal inside the worklet — so a change
// must re-post the frames message without rebuilding the frames it carries.
const ENV_TIME_KEYS: (keyof SynthParams)[] = ['attack', 'decay', 'release'];

// Parameters that only re-steer the spatial gain matrix
const SPATIAL_KEYS: (keyof SynthParams)[] = ['spaceBoost', 'spaceAngle'];
const ROUTING_KEYS: (keyof SynthParams)[] = ['fxRouting'];

// Parameters that only re-tune the Doppler reverb (master-bus effect)
const DOPPLER_KEYS: (keyof SynthParams)[] = [
  'dopplerMix',
  'dopplerMode',
  'dopplerSpeed',
  'dopplerRate',
  'dopplerShift',
  'dopplerSize',
  'dopplerDecay',
  'dopplerDamp',
];

function dopplerParams(p: SynthParams): DopplerParams {
  return {
    mix: p.dopplerMix,
    mode: p.dopplerMode,
    speed: p.dopplerSpeed,
    rate: p.dopplerRate,
    shift: p.dopplerShift,
    size: p.dopplerSize,
    decay: p.dopplerDecay,
    damp: p.dopplerDamp,
  };
}

// Parameters that only re-tune the bias-parity split (master-bus send)
const PARITY_KEYS: (keyof SynthParams)[] = [
  'parityMix',
  'parityBias',
  'parityToneUp',
  'parityToneDn',
  'parityDrive',
  'parityReso',
  'parityReverb',
  'parityFormant',
  'parityVowelUp',
  'parityVowelDn',
  'parityKeyTrack',
];

function parityParams(p: SynthParams, pitchRatio = 1): ParityParams {
  return {
    mix: p.parityMix,
    bias: p.parityBias,
    toneUp: p.parityToneUp,
    toneDn: p.parityToneDn,
    drive: p.parityDrive,
    reso: p.parityReso,
    reverb: p.parityReverb,
    formant: p.parityFormant,
    vowelUp: p.parityVowelUp,
    vowelDn: p.parityVowelDn,
    keyTrack: p.parityKeyTrack,
    pitchRatio,
  };
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  // The lowpass now lives per voice (so it can be swept by its own envelope); this is just
  // the dry junction the voices sum into, and the tap the post-filter FX send reads.
  private dryBus: GainNode | null = null;
  /** One cycle of white noise, shared by every voice that wants a noise layer. */
  private noiseBuffer: AudioBuffer | null = null;
  private preFxBus: GainNode | null = null;
  private postFxBus: GainNode | null = null;
  public analyser: AnalyserNode | null = null;
  private reverb: DopplerReverb | null = null;
  private parity: ParitySplit | null = null;
  private activeVoices: Map<number, AudioVoice> = new Map();
  private frames: CoefficientFrames | null = null;
  /** Semitone-bucketed frames for Hz-mode operator focus (index mode uses `frames` only). */
  private pitchFrames: Map<number, CoefficientFrames> = new Map();
  /** Expander frames, keyed by pitch bucket and divergence weight (one per unison slot). */
  private expandFrames: Map<string, CoefficientFrames> = new Map();
  private currentParams: SynthParams;
  private onVoiceStateChange: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private ready = false;

  constructor(initialParams: SynthParams) {
    this.currentParams = { ...initialParams };
  }

  public registerVoiceStateCallback(callback: () => void) {
    this.onVoiceStateChange = callback;
  }

  public start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.init().catch((err) => {
        this.startPromise = null;
        throw err;
      });
    }
    return this.startPromise;
  }

  private async init(): Promise<void> {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    this.ctx = new AudioContextClass();
    await this.ctx.audioWorklet.addModule(getWorkletUrl());
    await this.ctx.audioWorklet.addModule(getShimmerWorkletUrl());
    // Registered here so attachments that need an audio-thread clock (the buffer
    // transformer) can construct their node synchronously once the engine is ready.
    await this.ctx.audioWorklet.addModule(getTickerWorkletUrl());

    this.masterGain = this.ctx.createGain();
    this.dryBus = this.ctx.createGain();
    this.preFxBus = this.ctx.createGain();
    this.postFxBus = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();

    this.noiseBuffer = this.makeNoiseBuffer();
    this.masterGain.gain.value = this.currentParams.volume;

    // Voices feed the dry filter and a pre-filter FX tap. The route control crossfades
    // the pre/post taps so dark patches can excite formants/reverb before the master LPF.
    this.reverb = new DopplerReverb(this.ctx);
    this.parity = new ParitySplit(this.ctx);
    this.dryBus.connect(this.masterGain); // dry path
    this.dryBus.connect(this.postFxBus);
    this.preFxBus.connect(this.reverb.input);
    this.postFxBus.connect(this.reverb.input);
    this.reverb.wet.connect(this.masterGain); // wet return
    this.preFxBus.connect(this.parity.input);
    this.postFxBus.connect(this.parity.input);
    this.parity.output.connect(this.masterGain); // parity wet return
    this.parity.upperSend.connect(this.reverb.input); // peaks rail → Doppler reverb
    this.reverb.setParams(dopplerParams(this.currentParams));
    this.parity.setParams(parityParams(this.currentParams));
    this.updateFxRouting();

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.analyser.fftSize = 512;

    this.updateFrames();
    this.ready = true;
  }

  public setParams(params: SynthParams) {
    const old = this.currentParams;
    this.currentParams = { ...params };

    if (!this.ctx) return;

    if (old.cutoff !== params.cutoff || old.resonance !== params.resonance) {
      const t = this.ctx.currentTime;
      this.activeVoices.forEach((voice) => {
        voice.filter.Q.setTargetAtTime(params.resonance, t, 0.02);
        // While a filter envelope owns the cutoff, its scheduled ramps must not be fought;
        // the new base takes effect on the next note, as detune and unison already do.
        if (Math.abs(params.filterEnvAmount) <= 0.001) {
          voice.filter.frequency.setTargetAtTime(params.cutoff, t, 0.02);
        }
      });
    }
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(params.volume, this.ctx.currentTime);
    }

    if (FRAME_KEYS.some((k) => old[k] !== params[k])) {
      this.updateFrames();
      this.updateVoicePitches();
    } else if (ENV_TIME_KEYS.some((k) => old[k] !== params[k])) {
      // The sequence traversal reads the envelope times, so held voices need the new
      // message — but the coefficient frames are unchanged, so skip the rebuild.
      this.postFramesToVoices();
    }

    if (SPATIAL_KEYS.some((k) => old[k] !== params[k])) {
      this.updateSpatial();
    }

    if (this.reverb && DOPPLER_KEYS.some((k) => old[k] !== params[k])) {
      this.reverb.setParams(dopplerParams(params));
    }

    if (this.parity && PARITY_KEYS.some((k) => old[k] !== params[k])) {
      this.updateTrackedFxPitch();
    }

    if (ROUTING_KEYS.some((k) => old[k] !== params[k])) {
      this.updateFxRouting();
    }

    // `detune`, `unisonVoices`, and `expandProfile` are deliberately absent from every key
    // list above: they shape a voice at noteOn (spread + pan + divergence weights) and are
    // not re-applied to voices that are already sounding. Tweaking them affects the next
    // note, not held ones. The expander's depths *are* frame keys, so turning Diverge or
    // one of the spread knobs re-colors a held stack in place.
  }

  private updateFxRouting() {
    if (!this.ctx || !this.preFxBus || !this.postFxBus) return;
    const t = this.ctx.currentTime;
    const pre = this.currentParams.fxRouting >= 0.5 ? 1 : 0;
    this.preFxBus.gain.setTargetAtTime(pre, t, 0.02);
    this.postFxBus.gain.setTargetAtTime(1 - pre, t, 0.02);
  }

  /** Track the newest held note; released tails no longer steer the shared formant bank. */
  private updateTrackedFxPitch() {
    if (!this.parity) return;
    const held = Array.from(this.activeVoices.values()).filter((voice) => voice.releaseTime === undefined);
    const note = held.length ? held[held.length - 1].note : 48;
    const ratio = midiToFreq(note) / midiToFreq(48);
    this.parity.setParams(parityParams(this.currentParams, ratio));
  }

  private framesMessage(frames: CoefficientFrames | null = this.frames) {
    if (!frames) return null;
    const p = this.currentParams;
    return {
      type: 'frames',
      aR: frames.aR,
      aI: frames.aI,
      bR: frames.bR,
      bI: frames.bI,
      resR: frames.resR,
      resI: frames.resI,
      morphRate: p.motionRate,
      morphDepth: p.motionDepth,
      extendMix: p.extendMix,
      extendTime: p.extendTime,
      extendSkew: p.extendSkew,
      extendBloom: p.extendBloom,
      stagesR: frames.stagesR,
      stagesI: frames.stagesI,
      alphaDepth: p.alphaEnvDepth,
      alphaTime: p.alphaEnvTime,
      alphaMode: p.alphaEnvMode,
      flowDepth: frames.flowActive ? 1 : 0,
      // Sequence traversal. In envelope mode the worklet paces the stage walk off the
      // amplitude envelope's own sections instead of the α-time ramp, so it needs the
      // envelope times; `release` also arrives as a port message at note-off.
      seqDepth: frames.seqActive ? 1 : 0,
      seqEnvelope: frames.seqActive && p.arithSeqMode < 0.5 ? 1 : 0,
      envAttack: p.attack,
      envDecay: p.decay,
      envRelease: p.release,
    };
  }

  /** Semitone MIDI bucket for pitch-aware coefficient caches. */
  private pitchBucket(freq: number): number {
    return Math.round(69 + 12 * Math.log2(Math.max(20, freq) / 440));
  }

  private buildCoefficientFrames(p: SynthParams, refFreq: number): CoefficientFrames {
    const frameA = computeFourierSeries(p, p.harmonicsCount, STATIC_FLOW, refFreq);
    const frameB =
      p.motionDepth > 0.001
        ? computeFourierSeries(morphTargetParams(p), p.harmonicsCount, STATIC_FLOW, refFreq)
        : frameA;

    const alphaOn = p.alphaEnvDepth > 0.001;
    const mobiusActive =
      Math.abs(p.mobiusRotate) > 0.001 ||
      Math.abs(p.mobiusBoost) > 0.001 ||
      Math.abs(p.mobiusTilt) > 0.001 ||
      Math.abs(p.mobiusParabolic) > 0.001;
    const flowOn = p.mobiusFlow === 1 && mobiusActive;
    const thetaActive = Math.abs(p.thetaPhase) > 1e-4 || p.thetaHeat > 1e-4;
    const thetaFlowOn = p.thetaFlow === 1 && thetaActive;
    const cyclotomicFlowOn = p.cyclotomicFlow === 1 && p.cyclotomicMix > 0.001;
    // An arithmetic number sequence is a third driver of the genesis stages, alongside the
    // α-envelope and the flows: each number gets its own stage frame.
    const sequence = arithSequence(p);
    const seqOn = arithSequenceActive(p);
    const envOn = alphaOn || flowOn || thetaFlowOn || cyclotomicFlowOn || seqOn;

    const nonlinearFlow = flowOn || thetaFlowOn || cyclotomicFlowOn;
    // One stage per sequence number, but never fewer than a flow needs to trace its orbit.
    // When both are on and the counts differ, stages take the nearest sequence number, so a
    // number can repeat across two stages that differ only in their flow position.
    const numStages = Math.max(seqOn ? sequence.length : 2, nonlinearFlow ? 5 : 2);
    const rawStages: FourierResult[] = [];
    if (envOn) {
      const active: FlowActive = {
        alpha: alphaOn,
        mobius: flowOn,
        theta: thetaFlowOn,
        cyclotomic: cyclotomicFlowOn,
      };
      for (let stage = 0; stage < numStages; stage++) {
        const t = stage / (numStages - 1);
        const stageParams = seqOn
          ? { ...p, arithValue: sequence[Math.round(t * (sequence.length - 1))] }
          : p;
        rawStages.push(
          computeFourierSeries(stageParams, p.harmonicsCount, stageFlow(t, active), refFreq)
        );
      }
    }

    const peak = Math.max(framePeak(frameA.real, frameA.imag), 1e-4);
    const peakB =
      frameB === frameA ? peak : Math.max(framePeak(frameB.real, frameB.imag), 1e-4);
    let peakExt = peak;
    if (p.extendMix > 0.001) {
      const sumR = frameA.real.slice();
      const sumI = frameA.imag.slice();
      for (let i = 0; i < sumR.length; i++) {
        sumR[i] += frameA.residReal[i];
        sumI[i] += frameA.residImag[i];
      }
      peakExt = Math.max(framePeak(sumR, sumI), 1e-4);
    }
    let peakStages = peak;
    for (const st of rawStages) {
      peakStages = Math.max(peakStages, framePeak(st.real, st.imag));
    }
    const scale = 1 / Math.max(peak, peakB, peakExt, peakStages);

    const scaled = (src: Float32Array) => {
      const out = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) out[i] = src[i] * scale;
      return out;
    };

    const stagesR = rawStages.length
      ? rawStages.map((st) => scaled(st.real))
      : [scaled(frameA.real)];
    const stagesI = rawStages.length
      ? rawStages.map((st) => scaled(st.imag))
      : [scaled(frameA.imag)];

    return {
      aR: scaled(frameA.real),
      aI: scaled(frameA.imag),
      bR: scaled(frameB.real),
      bI: scaled(frameB.imag),
      resR: scaled(frameA.residReal),
      resI: scaled(frameA.residImag),
      stagesR,
      stagesI,
      flowActive: flowOn || thetaFlowOn || cyclotomicFlowOn,
      seqActive: seqOn,
    };
  }

  private framesForFrequency(freq: number): CoefficientFrames {
    const p = this.currentParams;
    if (p.bandMode < 0.5) {
      if (!this.frames) {
        this.frames = this.buildCoefficientFrames(p, FOCUS_REF_HZ);
      }
      return this.frames;
    }
    const bucket = this.pitchBucket(freq);
    let cached = this.pitchFrames.get(bucket);
    if (!cached) {
      cached = this.buildCoefficientFrames(p, midiToFreq(bucket));
      this.pitchFrames.set(bucket, cached);
      if (this.pitchFrames.size > 32) {
        const oldest = this.pitchFrames.keys().next().value;
        if (oldest !== undefined) this.pitchFrames.delete(oldest);
      }
    }
    return cached;
  }

  /**
   * Frames for one unison slot: the shared set when the expander is idle (so the common
   * path costs exactly what it always did), otherwise a set computed at that slot's
   * displaced parameters. Cached per (pitch bucket, weight) — a stack costs one extra
   * frame build per *distinct* weight, and slots that share a weight share the frames.
   */
  private framesForSlot(freq: number, weight: number): CoefficientFrames {
    const p = this.currentParams;
    const displaced = divergeParams(p, weight);
    if (displaced === p) return this.framesForFrequency(freq);
    const hzMode = p.bandMode >= 0.5;
    const bucket = hzMode ? this.pitchBucket(freq) : 48;
    const key = `${bucket}|${weight.toFixed(4)}`;
    let cached = this.expandFrames.get(key);
    if (!cached) {
      cached = this.buildCoefficientFrames(
        displaced,
        hzMode ? midiToFreq(bucket) : FOCUS_REF_HZ
      );
      this.expandFrames.set(key, cached);
      if (this.expandFrames.size > 48) {
        const oldest = this.expandFrames.keys().next().value;
        if (oldest !== undefined) this.expandFrames.delete(oldest);
      }
    }
    return cached;
  }

  /**
   * Send the current frames to every sounding node. Split out from `updateFrames` because
   * some parameters only change the *message* (the envelope times the sequence traversal
   * reads) and not the coefficient frames themselves — those must not pay for a rebuild.
   */
  private postFramesToVoices() {
    const p = this.currentParams;

    // One message for the whole pool only when neither the operator bands nor the
    // expander make a voice's spectrum depend on its pitch or its slot.
    if (p.bandMode < 0.5 && !expanderActive(p)) {
      const msg = this.framesMessage(this.frames);
      if (msg) {
        this.activeVoices.forEach((voice) => {
          voice.nodes.forEach((node) => node.port.postMessage(msg));
        });
      }
      return;
    }

    // Hz mode gives each sounding pitch its own operator-band snapshot; the expander
    // gives each slot within a voice its own displaced spectrum.
    const mult = this.pitchMultiplier();
    this.activeVoices.forEach((voice) => {
      const freq = midiToFreq(voice.note) * mult;
      voice.nodes.forEach((node, i) => {
        const msg = this.framesMessage(this.framesForSlot(freq, voice.weights[i] ?? 0));
        if (msg) node.port.postMessage(msg);
      });
    });
  }

  private updateFrames() {
    if (!this.ctx) return;
    this.pitchFrames.clear();
    this.expandFrames.clear();

    // Shared / display frames use C3 so bass-centric patches visualize correctly.
    this.frames = this.buildCoefficientFrames(this.currentParams, midiToFreq(48));
    this.postFramesToVoices();
  }

  /**
   * Stereo gains for a source at azimuth θ after the ambisonic dominance boost.
   *
   * The source is encoded into first-order horizontal B-format (FuMa: W = 1/√2,
   * X = cosθ, Y = sinθ), the field is transformed by Gerzon's dominance — a Lorentz
   * boost with λ = 4^spaceBoost toward azimuth spaceAngle, which moves apparent
   * directions as well as gains (the Möbius action on the circle of directions) —
   * and virtual cardioid microphones at ±45° decode back to stereo. The whole chain
   * is linear, so it collapses to one L/R gain pair per source.
   */
  private spatialGains(theta: number): { l: number; r: number } {
    const t = this.currentParams.spaceBoost;
    const phi = this.currentParams.spaceAngle;

    let W = Math.SQRT1_2;
    let X = Math.cos(theta);
    let Y = Math.sin(theta);

    if (Math.abs(t) > 0.001) {
      const lam = Math.pow(4, t);
      const a = (lam + 1 / lam) / 2;
      const b = (lam - 1 / lam) / (2 * Math.SQRT2);
      const c = (lam - 1 / lam) / Math.SQRT2;
      // Energy compensation: a raw boost multiplies the dominant direction by λ
      // (up to +12 dB); dividing by a = (λ+λ⁻¹)/2 caps it at +6 dB and keeps the
      // transform level-neutral at the identity.
      const comp = 1 / a;

      // Rotate so the dominance direction lies on +X, boost (W, X), rotate back
      const cr = Math.cos(phi);
      const sr = Math.sin(phi);
      const Xr = cr * X + sr * Y;
      const Yr = -sr * X + cr * Y;
      const Wd = (a * W + b * Xr) * comp;
      const Xd = (c * W + a * Xr) * comp;
      W = Wd;
      X = cr * Xd - sr * Yr * comp;
      Y = sr * Xd + cr * Yr * comp;
    }

    const c45 = Math.SQRT1_2;
    return {
      l: 0.5 * (Math.SQRT2 * W + c45 * X - c45 * Y),
      r: 0.5 * (Math.SQRT2 * W + c45 * X + c45 * Y),
    };
  }

  /** Re-steer every sounding source through the current dominance matrix. */
  private updateSpatial() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.activeVoices.forEach((voice) => {
      voice.azimuths.forEach((theta, i) => {
        const { l, r } = this.spatialGains(theta);
        voice.spatialL[i]?.gain.setTargetAtTime(l, t, 0.02);
        voice.spatialR[i]?.gain.setTargetAtTime(r, t, 0.02);
      });
    });
  }

  private pitchBendSemis = 0;

  /** Real-time pitch bend (semitones), applied on top of the timbre pitch offset. */
  public setPitchBend(semitones: number) {
    if (semitones === this.pitchBendSemis) return;
    this.pitchBendSemis = semitones;
    this.updateVoicePitches();
  }

  private pitchMultiplier(): number {
    const semitones =
      Math.sin(this.currentParams.bendAngle) * this.currentParams.bend2Amount * 4.0 +
      this.pitchBendSemis;
    return Math.pow(2, semitones / 12);
  }

  private updateVoicePitches() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mult = this.pitchMultiplier();
    this.activeVoices.forEach((voice) => {
      const targetFreq = midiToFreq(voice.note) * mult;
      voice.nodes.forEach((node) => {
        node.parameters.get('frequency')?.setValueAtTime(targetFreq, t);
      });
    });
  }

  /** Two seconds of white noise, looped — one buffer shared by every voice. */
  private makeNoiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    const frames = Math.floor(this.ctx.sampleRate * 2);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /**
   * Schedule a voice filter's cutoff for the life of a note.
   *
   * The envelope is measured in **octaves** around the Cutoff knob rather than in Hz, so a
   * given Amount sweeps the same musical distance wherever the base sits — a ±Hz amount, as
   * more conventional designs use, is a huge sweep down low and inaudible up high. Amount is
   * bipolar, so the filter can open upward or close downward, and everything is clamped into
   * the audible band. With Amount at zero the cutoff is simply set and left alone.
   */
  private scheduleFilterEnvelope(filter: BiquadFilterNode, t: number) {
    const p = this.currentParams;
    const base = Math.max(20, Math.min(20000, p.cutoff));
    if (Math.abs(p.filterEnvAmount) <= 0.001) {
      filter.frequency.setValueAtTime(base, t);
      return;
    }
    const clamp = (hz: number) => Math.max(20, Math.min(20000, hz));
    const peak = clamp(base * Math.pow(2, p.filterEnvAmount));
    const sustain = clamp(base * Math.pow(2, p.filterEnvAmount * p.filterEnvSustain));
    const attack = Math.max(0.001, p.filterEnvAttack);
    const decay = Math.max(0.001, p.filterEnvDecay);
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setValueAtTime(base, t);
    // Exponential ramps read as musically linear in pitch, and cannot reach or cross zero,
    // which is exactly right for a frequency.
    filter.frequency.exponentialRampToValueAtTime(peak, t + attack);
    filter.frequency.exponentialRampToValueAtTime(sustain, t + attack + decay);
  }

  /** Release leg of the filter envelope: fall back to the base cutoff over the amp release. */
  private releaseFilterEnvelope(filter: BiquadFilterNode, t: number) {
    const p = this.currentParams;
    if (Math.abs(p.filterEnvAmount) <= 0.001) return;
    const base = Math.max(20, Math.min(20000, p.cutoff));
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setValueAtTime(Math.max(20, filter.frequency.value), t);
    filter.frequency.exponentialRampToValueAtTime(base, t + Math.max(0.005, p.release));
  }

  /** Tear a voice's audio graph down and let its worklet processors die. */
  private teardown(voice: AudioVoice) {
    if (voice.dead) return;
    voice.dead = true;
    voice.nodes.forEach((node) => {
      try {
        node.port.postMessage({ type: 'stop' });
        node.disconnect();
      } catch (_) {}
    });
    voice.gains.forEach((g) => g.disconnect());
    voice.spatialL.forEach((g) => g.disconnect());
    voice.spatialR.forEach((g) => g.disconnect());
    voice.mergers.forEach((m) => m.disconnect());
    for (const src of [voice.sub, voice.noise]) {
      if (!src) continue;
      try {
        src.stop();
      } catch (_) {}
      try {
        src.disconnect();
      } catch (_) {}
    }
    try {
      voice.subGain?.disconnect();
      voice.noiseGain?.disconnect();
      voice.filter.disconnect();
      voice.voiceGain.disconnect();
    } catch (_) {}
  }

  public noteOn(note: number, frequency: number) {
    if (!this.ctx || !this.ready) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Steal any existing voice on this note: fast-fade it out and remove it from the
    // map NOW, so its delayed cleanup can never touch the voice we create next.
    const existing = this.activeVoices.get(note);
    if (existing) {
      this.activeVoices.delete(note);
      const tSteal = this.ctx.currentTime;
      existing.voiceGain.gain.cancelScheduledValues(tSteal);
      existing.voiceGain.gain.setValueAtTime(existing.voiceGain.gain.value, tSteal);
      existing.voiceGain.gain.linearRampToValueAtTime(0, tSteal + 0.01);
      setTimeout(() => this.teardown(existing), 40);
    }

    const t = this.ctx.currentTime;
    const p = this.currentParams;
    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(0, t);

    // Per-voice lowpass, so the cutoff can be swept by its own envelope. The pre-filter FX
    // send still taps ahead of it, which is what "pre" routing has always meant.
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(p.resonance, t);
    this.scheduleFilterEnvelope(filter, t);
    voiceGain.connect(filter);
    filter.connect(this.dryBus!);
    voiceGain.connect(this.preFxBus!);

    const a = p.attack;
    const d = p.decay;
    const s = p.sustain;
    if (p.attackCurve) {
      voiceGain.gain.setValueAtTime(0.0001, t);
      voiceGain.gain.exponentialRampToValueAtTime(1.0, Math.max(t + 0.001, t + a));
    } else {
      voiceGain.gain.linearRampToValueAtTime(1.0, t + a);
    }
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(s, 0.0001), t + a + d);

    // Sub oscillator and noise: one of each per note rather than per unison slot, summed
    // into the same voice gain so they share the amplitude envelope and the filter.
    let sub: OscillatorNode | undefined;
    let subGainNode: GainNode | undefined;
    let noise: AudioBufferSourceNode | undefined;
    let noiseGainNode: GainNode | undefined;
    const playedFreqForSub = frequency * this.pitchMultiplier();
    if (p.subGain > 0.001) {
      sub = this.ctx.createOscillator();
      sub.type = p.subWave >= 1.5 ? 'triangle' : p.subWave >= 0.5 ? 'square' : 'sine';
      sub.frequency.setValueAtTime(playedFreqForSub / (p.subOctave >= 0.5 ? 4 : 2), t);
      subGainNode = this.ctx.createGain();
      subGainNode.gain.value = p.subGain;
      sub.connect(subGainNode);
      subGainNode.connect(voiceGain);
      sub.start(t);
    }
    if (p.noiseGain > 0.001 && this.noiseBuffer) {
      noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      noiseGainNode = this.ctx.createGain();
      noiseGainNode.gain.value = p.noiseGain;
      noise.connect(noiseGainNode);
      noiseGainNode.connect(voiceGain);
      noise.start(t);
    }
    if (p.transientNoise && p.transientNoise > 0.001 && this.noiseBuffer) {
      const tNoise = this.ctx.createBufferSource();
      tNoise.buffer = this.noiseBuffer;
      tNoise.loop = true;
      const tNoiseGain = this.ctx.createGain();
      tNoiseGain.gain.setValueAtTime(0, t);
      tNoiseGain.gain.linearRampToValueAtTime(p.transientNoise, t + 0.002);
      tNoiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      tNoise.connect(tNoiseGain);
      tNoiseGain.connect(voiceGain);
      tNoise.start(t);
      tNoise.stop(t + 0.1);
    }

    const nodes: AudioWorkletNode[] = [];
    const gains: GainNode[] = [];
    const spatialL: GainNode[] = [];
    const spatialR: GainNode[] = [];
    const mergers: ChannelMergerNode[] = [];
    const azimuths: number[] = [];

    const numVoices = Math.max(1, this.currentParams.unisonVoices);
    const detuneCents = this.currentParams.detune;
    const playedFreq = frequency * this.pitchMultiplier();
    // Divergence weights are frozen here, next to detune and pan, so the stack keeps its
    // spectral identity for the life of the note.
    const weights = unisonWeights(numVoices, this.currentParams.expandProfile);

    for (let i = 0; i < numVoices; i++) {
      const node = new AudioWorkletNode(this.ctx, 'phase-projection-voice', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const oscGain = this.ctx.createGain();

      node.parameters.get('frequency')?.setValueAtTime(playedFreq, t);
      if (p.transientPunch && p.transientPunch > 0.001) {
        node.parameters.get('frequency')?.setValueAtTime(playedFreq * (1 + 8 * p.transientPunch), t);
        node.parameters.get('frequency')?.exponentialRampToValueAtTime(playedFreq, t + 0.05);
      }

      let detune = 0;
      let pan = 0;
      if (numVoices > 1) {
        const spread = i / (numVoices - 1); // 0 to 1
        detune = (spread - 0.5) * 2 * detuneCents;
        pan = (spread - 0.5) * 2 * 0.8;
      }
      node.parameters.get('detune')?.setValueAtTime(detune, t);

      // Unison spread mapped onto the frontal arc, then through the dominance field
      const theta = pan * (Math.PI / 2);
      const { l, r } = this.spatialGains(theta);
      const gL = this.ctx.createGain();
      const gR = this.ctx.createGain();
      gL.gain.value = l;
      gR.gain.value = r;
      const merger = this.ctx.createChannelMerger(2);

      oscGain.gain.value = 1.0 / Math.sqrt(numVoices);

      node.connect(oscGain);
      oscGain.connect(gL);
      oscGain.connect(gR);
      gL.connect(merger, 0, 0);
      gR.connect(merger, 0, 1);
      merger.connect(voiceGain);

      const msg = this.framesMessage(this.framesForSlot(playedFreq, weights[i]));
      if (msg) node.port.postMessage(msg);

      nodes.push(node);
      gains.push(oscGain);
      spatialL.push(gL);
      spatialR.push(gR);
      mergers.push(merger);
      azimuths.push(theta);
    }

    this.activeVoices.set(note, {
      note,
      nodes,
      gains,
      spatialL,
      spatialR,
      mergers,
      azimuths,
      weights,
      filter,
      sub,
      subGain: subGainNode,
      noise,
      noiseGain: noiseGainNode,
      voiceGain,
      triggerTime: t,
    });
    this.updateTrackedFxPitch();

    if (this.onVoiceStateChange) {
      this.onVoiceStateChange();
    }
  }

  public noteOff(note: number) {
    if (!this.ctx) return;

    const voice = this.activeVoices.get(note);
    if (!voice || voice.releaseTime !== undefined) return;

    const t = this.ctx.currentTime;
    voice.releaseTime = t;
    this.updateTrackedFxPitch();

    this.releaseFilterEnvelope(voice.filter, t);

    // Tell the worklets the key came up, so an envelope-paced sequence can enter its
    // release segment and walk to the final number.
    voice.nodes.forEach((node) => {
      try {
        node.port.postMessage({ type: 'release' });
      } catch (_) {}
    });

    const r = this.currentParams.release;
    voice.voiceGain.gain.cancelScheduledValues(t);
    voice.voiceGain.gain.setValueAtTime(voice.voiceGain.gain.value, t);
    voice.voiceGain.gain.linearRampToValueAtTime(0, t + r);

    setTimeout(() => {
      this.teardown(voice);
      // Only remove the map entry if this exact voice still owns it — a retrigger
      // may have replaced it in the meantime.
      if (this.activeVoices.get(note) === voice) {
        this.activeVoices.delete(note);
      }
      this.updateTrackedFxPitch();
      if (this.onVoiceStateChange) {
        this.onVoiceStateChange();
      }
    }, (r + 0.1) * 1000);
  }

  public triggerKick() {
    if (!this.ctx || this.ctx.state === 'suspended') return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.001, t + 0.5);
    gain.gain.setValueAtTime(1.0, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  public triggerShaker() {
    if (!this.ctx || this.ctx.state === 'suspended' || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 5000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start(t);
    noise.stop(t + 0.2);
  }

  public triggerCrash() {
    if (!this.ctx || this.ctx.state === 'suspended' || !this.noiseBuffer) return;
    const t = this.ctx.currentTime;
    
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.0);
    gain.connect(this.masterGain);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 6000;
    noise.connect(noiseFilter);
    noiseFilter.connect(gain);
    noise.start(t);
    noise.stop(t + 2.1);

    for (let i = 0; i < 4; i++) {
       const osc = this.ctx.createOscillator();
       osc.type = 'square';
       osc.frequency.value = 300 * Math.pow(1.5, i) + (Math.random() * 50);
       const oscGain = this.ctx.createGain();
       oscGain.gain.value = 0.15;
       osc.connect(oscGain);
       oscGain.connect(gain);
       osc.start(t);
       osc.stop(t + 2.1);
    }
  }

  public panic() {
    if (!this.ctx) return;
    this.activeVoices.forEach((voice) => this.teardown(voice));
    this.activeVoices.clear();
    this.updateTrackedFxPitch();
    if (this.onVoiceStateChange) {
      this.onVoiceStateChange();
    }
  }

  public getActiveNotes(): number[] {
    return Array.from(this.activeVoices.keys());
  }

  /**
   * Attachment points for modules that listen to the synth and add to it — currently the
   * buffer transformer.
   *
   * `analysisTap` is the master bus *before* the monitor analyser, and `monitorBus` is the
   * analyser itself. A module that reads the tap and writes to the monitor bus is therefore
   * heard and visualized, but its own output never reaches the node it is analysing, so
   * there is no feedback path to run away.
   */
  public get context(): AudioContext | null {
    return this.ctx;
  }

  public get analysisTap(): AudioNode | null {
    return this.masterGain;
  }

  public get monitorBus(): AudioNode | null {
    return this.analyser;
  }

  public getAnalyserData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(dataArray);
    return dataArray;
  }

  public getFrequencyData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(0);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }
}
