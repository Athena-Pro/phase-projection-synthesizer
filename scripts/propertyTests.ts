import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFourierSeries, STATIC_FLOW } from '../src/lib/audioEngine';
import { runPreProjectionProgram } from '../src/lib/cycleOperators';
import { frft, ComplexBuf } from '../src/lib/frft';
import {
  projectCycle,
  projectCycleToSubspace,
  reconstructCycle,
  spectrumEnergy,
} from '../src/lib/harmonicProjection';
import { composeBothOrders, SpectralOperator } from '../src/lib/operatorPipeline';
import { SYNTH_PRESETS } from '../src/lib/presets';
import { schwarzChristoffelBoundary } from '../src/lib/schwarzChristoffel';
import { SynthParams } from '../src/types';

const maxDelta = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  assert.equal(a.length, b.length);
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta = Math.max(delta, Math.abs(a[i] - b[i]));
  return delta;
};

const rmsDelta = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  assert.equal(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
};

test('Π is idempotent on its represented harmonic subspace', () => {
  const K = 256;
  const source = Array.from({ length: K }, (_, j) => {
    const theta = (2 * Math.PI * j) / K;
    return 0.3 + 0.7 * Math.cos(3 * theta) - 0.2 * Math.sin(7 * theta) + 0.4 * Math.cos(43 * theta);
  });
  const first = projectCycle(source, { harmonics: 12 });
  const represented = reconstructCycle(first);
  const second = projectCycle(represented, { harmonics: 12 });

  assert.ok(maxDelta(first.real, second.real) < 2e-7);
  assert.ok(maxDelta(first.imag, second.imag) < 2e-7);
  assert.ok(Math.abs(first.dc - second.dc) < 1e-12);
  const audible = reconstructCycle(first, K, false);
  assert.ok(rmsDelta(audible, projectCycleToSubspace(audible, { harmonics: 12 })) < 2e-7);
});

test('Π_{N,fs,f0} excludes harmonics above Nyquist', () => {
  const K = 256;
  const source = Array.from({ length: K }, (_, j) => Math.sin((2 * Math.PI * 30 * j) / K));
  const projection = projectCycle(source, {
    harmonics: 64,
    sampleRate: 48_000,
    fundamental: 1_000,
  });
  assert.equal(projection.admissibleHarmonics, 24);
  for (let n = 25; n < projection.real.length; n++) {
    assert.equal(projection.real[n], 0);
    assert.equal(projection.imag[n], 0);
  }
});

test('F^4 returns a complex buffer to itself', () => {
  const N = 64;
  let value: ComplexBuf = {
    re: Float64Array.from({ length: N }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * 0.11)),
    im: Float64Array.from({ length: N }, (_, i) => 0.2 * Math.sin(i * 0.23)),
  };
  const original = { re: value.re.slice(), im: value.im.slice() };
  for (let i = 0; i < 4; i++) value = frft(value, 1);
  assert.ok(maxDelta(value.re, original.re) < 1e-11);
  assert.ok(maxDelta(value.im, original.im) < 1e-11);
});

test('zero-strength pre-projection operators are the identity', () => {
  const params: SynthParams = {
    ...SYNTH_PRESETS[0].params,
    regimeMix: 0,
    zeroStretch: 0,
    zeroInsert: 0,
    frftMix: 0,
  };
  const K = 128;
  const source = Array.from({ length: K }, (_, i) => Math.sin((2 * Math.PI * i) / K));
  const result = runPreProjectionProgram(
    source,
    {
      samplesA: source,
      samplesB: source,
      arithmetic: null,
      harmonicsCount: 32,
    },
    params
  );
  assert.deepEqual(result, source);
});

test('operator composition exposes a non-zero commutator when order matters', () => {
  const add: SpectralOperator<number, undefined> = {
    id: 'add',
    label: 'add one',
    domain: 'cycle',
    properties: { invertible: true, preservesMagnitude: false, preservesEnergy: false },
    apply: (state) => state + 1,
  };
  const scale: SpectralOperator<number, undefined> = {
    id: 'scale',
    label: 'times two',
    domain: 'cycle',
    properties: { invertible: true, preservesMagnitude: false, preservesEnergy: false },
    apply: (state) => state * 2,
  };
  const { ab, ba } = composeBothOrders(3, add, scale, undefined);
  assert.equal(ab, 7);
  assert.equal(ba, 8);
  assert.equal(ab - ba, -1);
});

test('theta at zero heat preserves each harmonic magnitude', () => {
  const base: SynthParams = { ...SYNTH_PRESETS[0].params, harmonicsCount: 32, thetaPhase: 0, thetaHeat: 0 };
  const dry = computeFourierSeries(base, 32, STATIC_FLOW);
  const rotated = computeFourierSeries({ ...base, thetaPhase: 0.371 }, 32, STATIC_FLOW);
  for (let n = 1; n <= 32; n++) {
    const before = Math.hypot(dry.real[n], dry.imag[n]);
    const after = Math.hypot(rotated.real[n], rotated.imag[n]);
    assert.ok(Math.abs(before - after) < 2e-6, `harmonic ${n}: ${before} vs ${after}`);
  }
});

test('a full cyclotomic permutation preserves spectral energy', () => {
  const base: SynthParams = { ...SYNTH_PRESETS[0].params, harmonicsCount: 32, cyclotomicMix: 0 };
  const dry = computeFourierSeries(base, 32, STATIC_FLOW);
  const permuted = computeFourierSeries(
    { ...base, cyclotomicMix: 1, cyclotomicPower: 1, cyclotomicAction: 0 },
    32,
    STATIC_FLOW
  );
  const before = spectrumEnergy({ real: dry.real, imag: dry.imag });
  const after = spectrumEnergy({ real: permuted.real, imag: permuted.imag });
  assert.ok(Math.abs(before - after) / before < 2e-6);
});

test('the Operator Lab measures and auditions a real noncommutative patch', () => {
  const preset = SYNTH_PRESETS.find((entry) => entry.id === 'regime-lct-fold');
  assert.ok(preset);
  const params: SynthParams = {
    ...preset.params,
    labEnabled: 0,
    labOperatorA: 0,
    labOperatorB: 2,
    labResult: 4,
  };
  const inspected = computeFourierSeries(params, params.harmonicsCount, STATIC_FLOW, 130.81, true);
  assert.ok(inspected.lab);
  assert.ok(inspected.lab.metrics.commutatorRms > 0.1);
  assert.ok(inspected.lab.metrics.projectionCommutatorRms > 0.001);

  const auditioned = computeFourierSeries({ ...params, labEnabled: 1 }, params.harmonicsCount, STATIC_FLOW);
  assert.ok(auditioned.lab);
  assert.ok(rmsDelta(auditioned.samples, auditioned.lab.results.commutator.cycle) < 1e-12);
});

test('Schwarz–Christoffel correction closes the boundary and reports its raw defect', () => {
  const d = Float64Array.from([0, 0.2, -0.1, 0.35, -0.25, 0.1]);
  const e = Float64Array.from([0.1, -0.2, 0.3, -0.1, 0.2, -0.3]);
  const boundary = schwarzChristoffelBoundary(d, e, 256, 0.15, 0.8, 0.4);
  assert.ok(Math.hypot(boundary.re[255] - boundary.re[0], boundary.im[255] - boundary.im[0]) < 1e-10);
  assert.ok(boundary.diagnostics.closureDefect >= 0);
  assert.ok(boundary.diagnostics.correctionEnergy >= 0);
  assert.ok(boundary.diagnostics.prevertexProximity > 0);
  assert.ok(Number.isFinite(boundary.diagnostics.spectralTailSlope));
});
