/**
 * Schwarz–Christoffel map of the unit disk onto a polygon.
 *
 * Prevertices z_k ∈ S¹ come from the d_k spacings; turning weights β_k (Σ β = n−2)
 * come from the e_k. Integrates
 *   f'(z) = ∏_k (1 − z̄_k z)^{β_k − 1}
 * along the circle with a continuously tracked branch, then recenters and applies
 * the accessory constant C = cAbs · e^{i cAng}.
 *
 * `soften` ∈ [0, 1] blends β toward the regular n-gon (rounder corners).
 */

export interface SchwarzChristoffelDiagnostics {
  /** |f(2π)-f(0)| before the linear closure correction. */
  closureDefect: number;
  /** RMS size of the correction that was bled across the discretized boundary. */
  correctionEnergy: number;
  /** Largest discrete second difference after correction and accessory scaling. */
  maxCurvature: number;
  /** Smallest chord distance between adjacent prevertices on S¹. */
  prevertexProximity: number;
  /** Log-amplitude/log-harmonic regression over eight upper-band samples. */
  spectralTailSlope: number;
}

export function schwarzChristoffelBoundary(
  d: Float64Array,
  e: Float64Array,
  K: number,
  soften: number,
  cAbs: number,
  cAng: number
): { re: Float64Array; im: Float64Array; diagnostics: SchwarzChristoffelDiagnostics } {
  const nMax = Math.min(d.length, e.length);
  let n = 3;
  for (let k = 0; k < nMax; k++) {
    if (Math.abs(d[k]) + Math.abs(e[k]) > 1e-6) n = Math.max(n, k + 1);
  }
  n = Math.min(Math.max(3, n), nMax);

  const space = new Float64Array(n);
  let spaceSum = 0;
  for (let k = 0; k < n; k++) {
    space[k] = Math.exp(d[k]);
    spaceSum += space[k];
  }
  const zkR = new Float64Array(n);
  const zkI = new Float64Array(n);
  let phi = 0;
  for (let k = 0; k < n; k++) {
    zkR[k] = Math.cos(phi);
    zkI[k] = Math.sin(phi);
    phi += (2 * Math.PI * space[k]) / spaceSum;
  }
  let prevertexProximity = Infinity;
  for (let k = 0; k < n; k++) {
    const next = (k + 1) % n;
    prevertexProximity = Math.min(
      prevertexProximity,
      Math.hypot(zkR[k] - zkR[next], zkI[k] - zkI[next])
    );
  }

  const target = n - 2;
  const beta = new Float64Array(n);
  let rawSum = 0;
  for (let k = 0; k < n; k++) {
    beta[k] = Math.exp(e[k]);
    rawSum += beta[k];
  }
  for (let k = 0; k < n; k++) beta[k] = (beta[k] / Math.max(rawSum, 1e-12)) * target;

  const t = Math.max(0, Math.min(1, soften));
  const regular = target / n;
  let bSum = 0;
  for (let k = 0; k < n; k++) {
    beta[k] = (1 - t) * beta[k] + t * regular;
    beta[k] = Math.max(0.05, Math.min(1.95, beta[k]));
    bSum += beta[k];
  }
  for (let k = 0; k < n; k++) beta[k] *= target / bSum;

  const re = new Float64Array(K);
  const im = new Float64Array(K);
  const argTrack = new Float64Array(n);
  let fr = 0;
  let fi = 0;
  let prevZr = 1;
  let prevZi = 0;
  let prevFpr = 0;
  let prevFpi = 0;

  for (let j = 0; j < K; j++) {
    const theta = (j / K) * 2 * Math.PI;
    const zr = Math.cos(theta);
    const zi = Math.sin(theta);

    let logR = 0;
    let logI = 0;
    for (let k = 0; k < n; k++) {
      const ur = zkR[k] * zr + zkI[k] * zi;
      const ui = zkR[k] * zi - zkI[k] * zr;
      let vr = 1 - ur;
      let vi = -ui;
      let mag2 = vr * vr + vi * vi;
      if (mag2 < 1e-16) {
        mag2 = 1e-16;
        vr = 1e-8;
        vi = 0;
      }
      let ang = Math.atan2(vi, vr);
      if (j > 0) {
        let delta = ang - argTrack[k];
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        ang = argTrack[k] + delta;
      }
      argTrack[k] = ang;
      const exp = beta[k] - 1;
      logR += 0.5 * exp * Math.log(mag2);
      logI += exp * ang;
    }
    logR = Math.max(-40, Math.min(40, logR));
    const mag = Math.exp(logR);
    const fpr = mag * Math.cos(logI);
    const fpi = mag * Math.sin(logI);

    if (j > 0) {
      const dzr = zr - prevZr;
      const dzi = zi - prevZi;
      const ar = 0.5 * (prevFpr + fpr);
      const ai = 0.5 * (prevFpi + fpi);
      fr += ar * dzr - ai * dzi;
      fi += ar * dzi + ai * dzr;
    }
    re[j] = fr;
    im[j] = fi;
    prevZr = zr;
    prevZi = zi;
    prevFpr = fpr;
    prevFpi = fpi;
  }

  // Bleed off trapezoid drift so the polygon closes.
  const endR = re[K - 1];
  const endI = im[K - 1];
  const closureDefect = Math.hypot(endR, endI);
  let correctionSq = 0;
  for (let j = 1; j < K; j++) {
    const u = j / (K - 1);
    const correctionR = u * endR;
    const correctionI = u * endI;
    correctionSq += correctionR * correctionR + correctionI * correctionI;
    re[j] -= correctionR;
    im[j] -= correctionI;
  }
  const correctionEnergy = Math.sqrt(correctionSq / K);

  let meanR = 0;
  let meanI = 0;
  for (let j = 0; j < K; j++) {
    meanR += re[j];
    meanI += im[j];
  }
  meanR /= K;
  meanI /= K;

  const cr = cAbs * Math.cos(cAng);
  const ci = cAbs * Math.sin(cAng);
  for (let j = 0; j < K; j++) {
    const rr = re[j] - meanR;
    const ii = im[j] - meanI;
    re[j] = rr * cr - ii * ci;
    im[j] = rr * ci + ii * cr;
  }

  let maxCurvature = 0;
  for (let j = 0; j < K; j++) {
    const prev = (j + K - 1) % K;
    const next = (j + 1) % K;
    maxCurvature = Math.max(
      maxCurvature,
      Math.hypot(re[next] - 2 * re[j] + re[prev], im[next] - 2 * im[j] + im[prev])
    );
  }

  // Eight sparse DFT samples are enough for a resolution diagnostic without charging the
  // oscillator path for a full second transform.
  const tailX: number[] = [];
  const tailY: number[] = [];
  const firstTail = Math.max(2, Math.floor(K / 16));
  const lastTail = Math.max(firstTail + 1, Math.floor(K / 4));
  for (let q = 0; q < 8; q++) {
    const harmonic = Math.round(firstTail * Math.pow(lastTail / firstTail, q / 7));
    let sumR = 0;
    let sumI = 0;
    for (let j = 0; j < K; j++) {
      const angle = (-2 * Math.PI * harmonic * j) / K;
      const cs = Math.cos(angle);
      const sn = Math.sin(angle);
      sumR += re[j] * cs - im[j] * sn;
      sumI += re[j] * sn + im[j] * cs;
    }
    tailX.push(Math.log(harmonic));
    tailY.push(Math.log(Math.max(1e-15, Math.hypot(sumR, sumI) / K)));
  }
  const meanX = tailX.reduce((sum, value) => sum + value, 0) / tailX.length;
  const meanY = tailY.reduce((sum, value) => sum + value, 0) / tailY.length;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < tailX.length; i++) {
    covariance += (tailX[i] - meanX) * (tailY[i] - meanY);
    variance += (tailX[i] - meanX) ** 2;
  }
  const spectralTailSlope = variance > 0 ? covariance / variance : 0;

  return {
    re,
    im,
    diagnostics: {
      closureDefect,
      correctionEnergy,
      maxCurvature,
      prevertexProximity,
      spectralTailSlope,
    },
  };
}
