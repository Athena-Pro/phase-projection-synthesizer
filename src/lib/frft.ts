/**
 * Discrete fractional Fourier transform (FrFT) — a rotation of the time-frequency
 * plane by angle φ = a·π/2. a = 0 is the identity, a = 1 the (centered, unitary)
 * DFT, a = 2 parity flip, a = 4 the identity again.
 *
 * Implementation follows the Ozaktas–Arıkan–Kutay–Bozdağı decomposition: with
 * dimensionally normalized samples (spacing 1/√N), F^φ factors into
 *   chirp multiply → chirp convolution → chirp multiply,
 * valid for a ∈ [0.5, 1.5]; other orders are range-reduced by composing with exact
 * integer powers of F (centered DFT, parity flip, inverse DFT). The convolution runs
 * through a radix-2 FFT at size 2N, so N must be a power of two.
 */

export interface ComplexBuf {
  re: Float64Array;
  im: Float64Array;
}

function makeBuf(n: number): ComplexBuf {
  return { re: new Float64Array(n), im: new Float64Array(n) };
}

/** In-place iterative radix-2 FFT. `invert` gives the (unscaled) inverse. */
function fft(re: Float64Array, im: Float64Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Centered unitary DFT: X(k) = (1/√N)·Σ x(n)·e^{-2πi nk/N} over n,k ∈ [-N/2, N/2).
 * Storage index i represents n = i − N/2. For N divisible by 4 this reduces to
 * (−1)^i pre/post twiddles around a standard FFT.
 */
function centeredDft(x: ComplexBuf, inverse: boolean): ComplexBuf {
  const n = x.re.length;
  const out = makeBuf(n);
  for (let i = 0; i < n; i++) {
    const s = i % 2 === 0 ? 1 : -1;
    out.re[i] = x.re[i] * s;
    out.im[i] = (inverse ? -x.im[i] : x.im[i]) * s;
  }
  fft(out.re, out.im, false);
  const scale = 1 / Math.sqrt(n);
  for (let j = 0; j < n; j++) {
    const s = (j % 2 === 0 ? 1 : -1) * scale;
    out.re[j] *= s;
    out.im[j] = (inverse ? -out.im[j] : out.im[j]) * s;
  }
  return out;
}

/** Parity operator F²: x(n) → x(−n). */
function flip(x: ComplexBuf): ComplexBuf {
  const n = x.re.length;
  const out = makeBuf(n);
  out.re[0] = x.re[0];
  out.im[0] = x.im[0];
  for (let i = 1; i < n; i++) {
    out.re[i] = x.re[n - i];
    out.im[i] = x.im[n - i];
  }
  return out;
}

/** Bandlimited ×2 upsampling via zero-padding the centered spectrum. */
function upsample2(x: ComplexBuf): ComplexBuf {
  const n = x.re.length;
  const X = centeredDft(x, false);
  const pad = makeBuf(2 * n);
  // Centered frequencies k ∈ [−N/2, N/2) land at storage k + N in the 2N spectrum
  for (let i = 0; i < n; i++) {
    pad.re[i + n / 2] = X.re[i];
    pad.im[i + n / 2] = X.im[i];
  }
  const up = centeredDft(pad, true);
  const s = Math.SQRT2; // keep sample amplitudes unchanged
  for (let i = 0; i < 2 * n; i++) {
    up.re[i] *= s;
    up.im[i] *= s;
  }
  return up;
}

/**
 * Chirp-convolution core, valid for order a with 0.5 ≤ |a| ≤ 1.5.
 *
 * The signal is upsampled ×2 first (the chirp products double the bandwidth), the
 * chirp phases use the halved sample spacing u = m/(2√N), and the result is
 * decimated back to N points.
 */
function frftCore(x: ComplexBuf, a: number): ComplexBuf {
  const n = x.re.length;
  const phi = (a * Math.PI) / 2;
  const sinPhi = Math.sin(phi);
  const tanHalf = Math.tan(phi / 2);
  const cscPhi = 1 / sinPhi;

  const up = upsample2(x); // 2N samples, centered index m = i − N, u = m/(2√N)
  const M = 2 * n;
  const denom = 4 * n; // (m/(2√N))² = m²/(4N)

  // g(m) = up(m)·e^{-iπ tan(φ/2) m²/(4N)}
  const g = makeBuf(2 * M);
  for (let i = 0; i < M; i++) {
    const m = i - n;
    const ph = (-Math.PI * tanHalf * m * m) / denom;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    g.re[i] = up.re[i] * c - up.im[i] * s;
    g.im[i] = up.re[i] * s + up.im[i] * c;
  }

  // Kernel c(d) = e^{iπ csc(φ) d²/(4N)} for lag d ∈ (−M, M), wrapped into 2M
  const ker = makeBuf(2 * M);
  for (let d = -M + 1; d < M; d++) {
    const ph = (Math.PI * cscPhi * d * d) / denom;
    const idx = (d + 2 * M) % (2 * M);
    ker.re[idx] = Math.cos(ph);
    ker.im[idx] = Math.sin(ph);
  }

  // Linear convolution via FFT at size 2M
  fft(g.re, g.im, false);
  fft(ker.re, ker.im, false);
  for (let i = 0; i < 2 * M; i++) {
    const r = g.re[i] * ker.re[i] - g.im[i] * ker.im[i];
    g.im[i] = g.re[i] * ker.im[i] + g.im[i] * ker.re[i];
    g.re[i] = r;
  }
  fft(g.re, g.im, true);
  const invScale = 1 / (2 * M); // FFT inverse normalization

  // A_φ/(2√N): kernel amplitude times the integration measure du = 1/(2√N)
  const aAng = -((Math.PI * Math.sign(sinPhi)) / 4) + phi / 2;
  const aMag = 1 / (2 * Math.sqrt(n * Math.abs(sinPhi)));
  const aRe = Math.cos(aAng) * aMag;
  const aIm = Math.sin(aAng) * aMag;

  // Post-chirp on the fine grid, then decimate back to N (out j ← fine 2j)
  const out = makeBuf(n);
  for (let j = 0; j < n; j++) {
    const i = 2 * j;
    const m = i - n;
    const ph = (-Math.PI * tanHalf * m * m) / denom;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const hr = g.re[i] * invScale;
    const hi = g.im[i] * invScale;
    const r1 = hr * c - hi * s;
    const i1 = hr * s + hi * c;
    out.re[j] = r1 * aRe - i1 * aIm;
    out.im[j] = r1 * aIm + i1 * aRe;
  }
  return out;
}

/**
 * Fractional Fourier transform of order a (period 4). Storage index i represents the
 * centered sample n = i − N/2; N must be a power of two divisible by 4.
 */
export function frft(x: ComplexBuf, order: number): ComplexBuf {
  const n = x.re.length;
  if ((n & (n - 1)) !== 0 || n % 4 !== 0) {
    throw new Error('frft: length must be a power of two divisible by 4');
  }
  let a = ((order % 4) + 4) % 4;
  const EPS = 1e-4;

  if (a < EPS || a > 4 - EPS) return { re: x.re.slice(), im: x.im.slice() };
  if (Math.abs(a - 1) < EPS) return centeredDft(x, false);
  if (Math.abs(a - 2) < EPS) return flip(x);
  if (Math.abs(a - 3) < EPS) return centeredDft(x, true);

  // Range-reduce to a chirp-friendly order in [0.5, 1.5] by composing with exact
  // integer powers of F applied FIRST: F^a = F^{a−k} ∘ F^k.
  let y = x;
  if (a < 0.5) {
    y = centeredDft(y, true); // F^{-1}
    a += 1; // now in [1, 1.5)
  } else if (a > 1.5 && a <= 2.5) {
    y = centeredDft(y, false); // F^{1}
    a -= 1; // now in (0.5, 1.5]
  } else if (a > 2.5 && a <= 3.5) {
    y = flip(y); // F^{2}
    a -= 2; // now in (0.5, 1.5]
  } else if (a > 3.5) {
    y = centeredDft(y, true); // F^{3} = F^{-1}
    a -= 3; // now in (0.5, 1)
  }
  return frftCore(y, a);
}

/**
 * Linear canonical transform of a real single-cycle buffer, tuned for the synth's
 * pipeline. This is the full metaplectic action Mp(2,ℝ) on the cycle, not just the
 * FrFT rotation: by the Iwasawa KAN factorization every element of SL(2,ℝ) is
 *
 *     rotate (FrFT) · squeeze (scaling) · shear (chirp),
 *
 * and each generator is a one-parameter subgroup. `order` drives the rotation
 * (elliptic), `squeeze` the hyperbolic scaling of the time–frequency plane, and
 * `shear` the parabolic chirp. squeeze = shear = 0 recovers the pure FrFT.
 *
 * The framing discipline is the same as before, and for the same reason: the discrete
 * chirp algorithm is only accurate for signals whose Wigner distribution fits inside
 * the rotation-safe circle of the sampling grid. So we
 *
 *   1. bandlimit the cycle to `maxHarmonic` (the synth projects onto ≤128
 *      harmonics afterwards, so this is lossless downstream), and
 *   2. embed it in the center of a 2× zero frame,
 *
 * apply shear → squeeze → rotate inside the frame, then crop the center back out,
 * take the real part, and RMS-match to the input.
 */
export function lctCycle(
  samples: number[],
  order: number,
  squeeze = 0,
  shear = 0,
  maxHarmonic = 128
): number[] {
  const n = samples.length;
  const buf = makeBuf(n);
  let rmsIn = 0;
  for (let i = 0; i < n; i++) {
    buf.re[i] = samples[i];
    rmsIn += samples[i] * samples[i];
  }
  rmsIn = Math.sqrt(rmsIn / n);

  // Bandlimit: zero all centered-spectrum bins with |k| > maxHarmonic
  const spec = centeredDft(buf, false);
  for (let i = 0; i < n; i++) {
    const k = i - n / 2;
    if (Math.abs(k) > maxHarmonic) {
      spec.re[i] = 0;
      spec.im[i] = 0;
    }
  }
  const band = centeredDft(spec, true);

  // Embed in the center of a 2× frame
  let frame = makeBuf(2 * n);
  for (let i = 0; i < n; i++) {
    frame.re[i + n / 2] = band.re[i];
    frame.im[i + n / 2] = band.im[i];
  }

  const M = 2 * n;
  const center = M / 2;

  // Shear (parabolic): chirp multiply x(u) ↦ e^{iπ·C·shear·u²}·x(u). u is the frame
  // coordinate normalized so the embedded signal spans [−0.5, 0.5]; C sets the phase
  // curvature. A quadratic phase across the cycle is a dispersive time–frequency skew.
  if (Math.abs(shear) > 1e-4) {
    const C = 12;
    for (let i = 0; i < M; i++) {
      const u = (i - center) / n;
      const ph = Math.PI * C * shear * u * u;
      const cs = Math.cos(ph);
      const sn = Math.sin(ph);
      const re = frame.re[i];
      const im = frame.im[i];
      frame.re[i] = re * cs - im * sn;
      frame.im[i] = re * sn + im * cs;
    }
  }

  // Squeeze (hyperbolic): scaling x(t) ↦ √s·x(s·t) about the frame center. s = 2^squeeze,
  // so squeeze > 0 compresses the cycle in time (energy spreads to higher harmonics —
  // brighter) and squeeze < 0 dilates it (energy collapses toward the fundamental).
  if (Math.abs(squeeze) > 1e-4) {
    const s = Math.pow(2, squeeze);
    const amp = Math.sqrt(s);
    const scaled = makeBuf(M);
    for (let i = 0; i < M; i++) {
      const pos = center + (i - center) * s;
      const i0 = Math.floor(pos);
      const i1 = i0 + 1;
      const fr = pos - i0;
      let re = 0;
      let im = 0;
      if (i0 >= 0 && i0 < M) {
        re += frame.re[i0] * (1 - fr);
        im += frame.im[i0] * (1 - fr);
      }
      if (i1 >= 0 && i1 < M) {
        re += frame.re[i1] * fr;
        im += frame.im[i1] * fr;
      }
      scaled.re[i] = re * amp;
      scaled.im[i] = im * amp;
    }
    frame = scaled;
  }

  const rotated = frft(frame, order);

  // Crop the center back out, take the real part, RMS-match
  let rmsOut = 0;
  for (let i = 0; i < n; i++) {
    const v = rotated.re[i + n / 2];
    rmsOut += v * v;
  }
  rmsOut = Math.sqrt(rmsOut / n);
  const scale = rmsOut > 1e-9 ? rmsIn / rmsOut : 1;

  const result = new Array<number>(n);
  for (let i = 0; i < n; i++) result[i] = rotated.re[i + n / 2] * scale;
  return result;
}

/**
 * Pure FrFT of a real single-cycle buffer — the rotation-only special case of
 * {@link lctCycle}. α = 0 returns the (bandlimited) cycle unchanged.
 */
export function frftCycle(
  samples: number[],
  order: number,
  maxHarmonic = 128
): number[] {
  return lctCycle(samples, order, 0, 0, maxHarmonic);
}
