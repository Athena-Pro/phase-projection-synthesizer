import { SynthParams } from '../types';
import {
  CycleOperatorContext,
  CycleOperatorState,
  cycleOperatorFromIndex,
} from './cycleOperators';
import {
  HarmonicProjection,
  cycleRms,
  projectCycle,
  projectCycleToSubspace,
} from './harmonicProjection';
import { composeBothOrders } from './operatorPipeline';

export const LAB_RESULT_IDS = [
  'a',
  'b',
  'ab',
  'ba',
  'commutator',
  'projectA',
  'aProject',
  'projectionCommutator',
] as const;
export type LabResultId = (typeof LAB_RESULT_IDS)[number];

export const LAB_RESULT_LABELS: Record<LabResultId, string> = {
  a: 'A(x)',
  b: 'B(x)',
  ab: 'A∘B(x)',
  ba: 'B∘A(x)',
  commutator: '[A,B](x)',
  projectA: 'ΠA(x)',
  aProject: 'AΠ(x)',
  projectionCommutator: '[Π,A](x)',
};

export interface OperatorLabResult {
  id: LabResultId;
  label: string;
  cycle: number[];
  projection: HarmonicProjection;
}

export interface OperatorLabMetrics {
  commutatorRms: number;
  differenceEnergy: number;
  spectralCosineDistance: number;
  magnitudeDistance: number;
  phaseDistance: number;
  entropy: number;
  spectralCentroid: number;
  projectionLoss: number;
  projectionCommutatorRms: number;
}

export interface OperatorLabAnalysis {
  operatorA: { id: string; label: string };
  operatorB: { id: string; label: string };
  selected: LabResultId;
  results: Record<LabResultId, OperatorLabResult>;
  metrics: OperatorLabMetrics;
}

const subtract = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
  const K = Math.min(a.length, b.length);
  const out = new Array<number>(K);
  for (let i = 0; i < K; i++) out[i] = a[i] - b[i];
  return out;
};

const rmsDistance = (a: ArrayLike<number>, b: ArrayLike<number>) => cycleRms(subtract(a, b));

function spectralDistances(a: HarmonicProjection, b: HarmonicProjection) {
  const N = Math.min(a.real.length, b.real.length) - 1;
  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  let magnitudeDelta = 0;
  let phaseDelta = 0;
  let phaseWeight = 0;
  for (let n = 1; n <= N; n++) {
    const ar = a.real[n];
    const ai = a.imag[n];
    const br = b.real[n];
    const bi = b.imag[n];
    const ma = Math.hypot(ar, ai);
    const mb = Math.hypot(br, bi);
    dot += ar * br + ai * bi;
    energyA += ma * ma;
    energyB += mb * mb;
    magnitudeDelta += (ma - mb) ** 2;
    if (ma * mb > 1e-12) {
      const raw = Math.atan2(ai, ar) - Math.atan2(bi, br);
      const wrapped = Math.atan2(Math.sin(raw), Math.cos(raw));
      const weight = Math.sqrt(ma * mb);
      phaseDelta += Math.abs(wrapped) * weight;
      phaseWeight += weight;
    }
  }
  const denom = Math.sqrt(energyA * energyB);
  return {
    cosine: denom > 1e-12 ? 1 - Math.max(-1, Math.min(1, dot / denom)) : 0,
    magnitude: denom > 1e-12 ? Math.sqrt(magnitudeDelta) / Math.sqrt(denom) : 0,
    phase: phaseWeight > 1e-12 ? phaseDelta / (Math.PI * phaseWeight) : 0,
  };
}

function distributionMetrics(projection: HarmonicProjection) {
  const N = projection.real.length - 1;
  const powers = new Array<number>(N);
  let total = 0;
  let weighted = 0;
  for (let n = 1; n <= N; n++) {
    const power = projection.real[n] ** 2 + projection.imag[n] ** 2;
    powers[n - 1] = power;
    total += power;
    weighted += n * power;
  }
  let entropy = 0;
  if (total > 1e-12) {
    for (const power of powers) {
      if (power <= 0) continue;
      const probability = power / total;
      entropy -= probability * Math.log(probability);
    }
  }
  return {
    entropy: N > 1 ? entropy / Math.log(N) : 0,
    centroid: total > 1e-12 ? weighted / total : 0,
  };
}

/** Evaluate the algebra requested by the Operator Laboratory against one source cycle. */
export function analyzeOperatorLab(
  source: number[],
  context: CycleOperatorContext,
  params: SynthParams
): OperatorLabAnalysis {
  const a = cycleOperatorFromIndex(params.labOperatorA);
  const b = cycleOperatorFromIndex(params.labOperatorB ?? 2);
  const initial: CycleOperatorState = { cycle: source, context };
  const stateA = a.apply(initial, params);
  const stateB = b.apply(initial, params);
  const { ab, ba } = composeBothOrders(initial, a, b, params);

  const projectionOptions = { harmonics: context.harmonicsCount };
  const projectedSource = projectCycleToSubspace(source, projectionOptions);
  const projectA = projectCycleToSubspace(stateA.cycle, projectionOptions);
  // Π acts on the whole represented state, including an alternate regime source. That
  // keeps [Π,A] about representation order rather than accidentally comparing a projected
  // main cycle against an unprojected side input.
  const projectedContext: CycleOperatorContext = {
    ...context,
    samplesA: projectCycleToSubspace(context.samplesA, projectionOptions),
    samplesB: projectCycleToSubspace(context.samplesB, projectionOptions),
    arithmetic: context.arithmetic
      ? projectCycleToSubspace(context.arithmetic, projectionOptions)
      : null,
  };
  const aProject = a.apply({ cycle: projectedSource, context: projectedContext }, params).cycle;
  const raw: Record<LabResultId, number[]> = {
    a: stateA.cycle,
    b: stateB.cycle,
    ab: ab.cycle,
    ba: ba.cycle,
    commutator: subtract(ab.cycle, ba.cycle),
    projectA,
    aProject,
    projectionCommutator: subtract(projectA, aProject),
  };

  const results = {} as Record<LabResultId, OperatorLabResult>;
  for (const id of LAB_RESULT_IDS) {
    results[id] = {
      id,
      label: LAB_RESULT_LABELS[id],
      cycle: raw[id],
      projection: projectCycle(raw[id], projectionOptions),
    };
  }

  const spectral = spectralDistances(results.ab.projection, results.ba.projection);
  const distribution = distributionMetrics(results.commutator.projection);
  const sourceRms = Math.max(cycleRms(source), 1e-12);
  const projected = projectCycleToSubspace(source, projectionOptions);
  const selected = LAB_RESULT_IDS[
    Math.max(0, Math.min(LAB_RESULT_IDS.length - 1, Math.round(params.labResult ?? 4)))
  ];

  return {
    operatorA: { id: a.id, label: a.label },
    operatorB: { id: b.id, label: b.label },
    selected,
    results,
    metrics: {
      commutatorRms: cycleRms(raw.commutator),
      differenceEnergy: (cycleRms(raw.commutator) / sourceRms) ** 2,
      spectralCosineDistance: spectral.cosine,
      magnitudeDistance: spectral.magnitude,
      phaseDistance: spectral.phase,
      entropy: distribution.entropy,
      spectralCentroid: distribution.centroid,
      projectionLoss: rmsDistance(source, projected) / sourceRms,
      projectionCommutatorRms: cycleRms(raw.projectionCommutator),
    },
  };
}
