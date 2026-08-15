/**
 * The synth's explicit harmonic projector Π.
 *
 * A represented cycle may contain discontinuities, warped time, or geometry that is not
 * itself bandlimited. `projectCycle` collapses that representation onto the admissible
 * real Fourier basis. The coefficient convention matches PeriodicWave and the additive
 * worklet:
 *
 *   x(θ) = dc + Σₙ real[n] cos(nθ) + imag[n] sin(nθ)
 *
 * DC is tracked as metadata but remains outside the coefficient arrays because the audio
 * renderer intentionally starts at harmonic one.
 */

export interface HarmonicProjection {
  real: Float32Array;
  imag: Float32Array;
  dc: number;
  sampleCount: number;
  requestedHarmonics: number;
  admissibleHarmonics: number;
  sampleRate?: number;
  fundamental?: number;
}

export interface ProjectionOptions {
  harmonics: number;
  /** Optional renderer limits. When supplied, bins above Nyquist are not admitted. */
  sampleRate?: number;
  fundamental?: number;
}

export function admissibleHarmonicCount({
  harmonics,
  sampleRate,
  fundamental,
}: ProjectionOptions): number {
  const requested = Math.max(0, Math.floor(harmonics));
  if (!sampleRate || !fundamental || sampleRate <= 0 || fundamental <= 0) return requested;
  return Math.min(requested, Math.max(0, Math.floor(sampleRate / (2 * fundamental))));
}

/** Project one real cycle onto Π_{N,fs,f0}. */
export function projectCycle(
  samples: ArrayLike<number>,
  options: ProjectionOptions
): HarmonicProjection {
  const K = samples.length;
  const requested = Math.max(0, Math.floor(options.harmonics));
  const admitted = Math.min(admissibleHarmonicCount(options), Math.floor((K - 1) / 2));
  const real = new Float32Array(requested + 1);
  const imag = new Float32Array(requested + 1);

  if (K === 0) {
    return {
      real,
      imag,
      dc: 0,
      sampleCount: 0,
      requestedHarmonics: requested,
      admissibleHarmonics: 0,
      sampleRate: options.sampleRate,
      fundamental: options.fundamental,
    };
  }

  let dc = 0;
  for (let j = 0; j < K; j++) dc += Number.isFinite(samples[j]) ? samples[j] : 0;
  dc /= K;

  for (let n = 1; n <= admitted; n++) {
    let sumCos = 0;
    let sumSin = 0;
    for (let j = 0; j < K; j++) {
      const value = Number.isFinite(samples[j]) ? samples[j] : 0;
      const theta = (j / K) * 2 * Math.PI;
      sumCos += value * Math.cos(n * theta);
      sumSin += value * Math.sin(n * theta);
    }
    real[n] = (2 / K) * sumCos;
    imag[n] = (2 / K) * sumSin;
  }

  return {
    real,
    imag,
    dc,
    sampleCount: K,
    requestedHarmonics: requested,
    admissibleHarmonics: admitted,
    sampleRate: options.sampleRate,
    fundamental: options.fundamental,
  };
}

/** Reconstruct a cycle in the range of Π. */
export function reconstructCycle(
  projection: Pick<HarmonicProjection, 'real' | 'imag' | 'dc' | 'sampleCount'>,
  sampleCount = projection.sampleCount,
  includeDc = true
): number[] {
  const K = Math.max(0, Math.floor(sampleCount));
  const N = Math.min(projection.real.length, projection.imag.length) - 1;
  const out = new Array<number>(K);
  for (let j = 0; j < K; j++) {
    const theta = (j / K) * 2 * Math.PI;
    let value = includeDc ? projection.dc : 0;
    for (let n = 1; n <= N; n++) {
      value += projection.real[n] * Math.cos(n * theta) + projection.imag[n] * Math.sin(n * theta);
    }
    out[j] = value;
  }
  return out;
}

/** Apply Π and return its represented cycle, useful for ΠA/AΠ comparisons. */
export function projectCycleToSubspace(
  samples: ArrayLike<number>,
  options: ProjectionOptions
): number[] {
  // The audible subspace begins at n=1. DC remains available on the projection object as
  // a diagnostic, but Π itself discards it just as the additive renderer does.
  return reconstructCycle(projectCycle(samples, options), samples.length, false);
}

export function spectrumEnergy(
  projection: Pick<HarmonicProjection, 'real' | 'imag'>
): number {
  const N = Math.min(projection.real.length, projection.imag.length) - 1;
  let energy = 0;
  for (let n = 1; n <= N; n++) {
    energy += projection.real[n] ** 2 + projection.imag[n] ** 2;
  }
  return energy;
}

export function cycleRms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
