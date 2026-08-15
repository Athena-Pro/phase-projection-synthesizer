import { SynthParams } from '../types';
import { lctCycle } from './frft';
import { SpectralOperator, runOperatorPipeline } from './operatorPipeline';
import { applyRegimeSplit } from './regimeSplit';
import { applyZeroPivotTransform } from './zeroPivot';

export const CYCLE_OPERATOR_IDS = ['regime', 'zeroPivot', 'lct'] as const;
export type CycleOperatorId = (typeof CYCLE_OPERATOR_IDS)[number];

export interface CycleOperatorContext {
  samplesA: number[];
  samplesB: number[];
  arithmetic: ArrayLike<number> | null;
  harmonicsCount: number;
  /** A genesis stage can override the patch's static LCT mix. */
  lctMix?: number;
}

export interface CycleOperatorState {
  cycle: number[];
  context: CycleOperatorContext;
}

const regime: SpectralOperator<CycleOperatorState, SynthParams> = {
  id: 'regime',
  label: 'Regime split',
  domain: 'cycle',
  properties: { invertible: false, preservesMagnitude: false, preservesEnergy: false },
  apply(state, p) {
    if (p.regimeMix <= 0.001) return state;
    const source = Math.round(p.regimeSource);
    const ruleB =
      source === 1
        ? state.context.samplesB
        : source === 2 && state.context.arithmetic
          ? state.context.arithmetic
          : source === 3
            ? state.cycle
            : state.context.samplesA;
    return {
      ...state,
      cycle: applyRegimeSplit(state.cycle, ruleB, {
        threshold: p.regimeThreshold,
        asym: p.regimeAsym,
        rail: p.regimeRail,
        offsetUp: p.regimeOffsetUp,
        offsetDn: p.regimeOffsetDn,
        knee: p.regimeKnee,
        mix: p.regimeMix,
      }),
    };
  },
};

const zeroPivot: SpectralOperator<CycleOperatorState, SynthParams> = {
  id: 'zeroPivot',
  label: 'Zero pivot',
  domain: 'cycle',
  properties: { invertible: false, preservesMagnitude: false, preservesEnergy: false },
  apply(state, p) {
    return {
      ...state,
      cycle: applyZeroPivotTransform(state.cycle, p.zeroStretch, p.zeroInsert),
    };
  },
};

const lct: SpectralOperator<CycleOperatorState, SynthParams> = {
  id: 'lct',
  label: 'LCT',
  domain: 'cycle',
  properties: { invertible: true, preservesMagnitude: false, preservesEnergy: true },
  apply(state, p) {
    const mix = state.context.lctMix ?? p.frftMix;
    const rotates = p.frftAngle > 0.002 && p.frftAngle < 3.998;
    const deforms = Math.abs(p.frftSqueeze) > 0.001 || Math.abs(p.frftShear) > 0.001;
    if (mix <= 0.001 || (!rotates && !deforms)) return state;

    const transformed = lctCycle(
      state.cycle,
      p.frftAngle,
      p.frftSqueeze,
      p.frftShear,
      state.context.harmonicsCount
    );
    return {
      ...state,
      cycle: state.cycle.map((sample, j) => (1 - mix) * sample + mix * transformed[j]),
    };
  },
};

export const CYCLE_OPERATORS: Record<
  CycleOperatorId,
  SpectralOperator<CycleOperatorState, SynthParams>
> = { regime, zeroPivot, lct };

/** The pre-projection portion of a normal patch, expressed as an operator program. */
export const PRE_PROJECTION_PROGRAM = [regime, zeroPivot, lct] as const;

export function runPreProjectionProgram(
  cycle: number[],
  context: CycleOperatorContext,
  params: SynthParams
): number[] {
  return runOperatorPipeline({ cycle, context }, PRE_PROJECTION_PROGRAM, params).cycle;
}

export function cycleOperatorFromIndex(index: number | undefined) {
  return CYCLE_OPERATORS[CYCLE_OPERATOR_IDS[Math.max(0, Math.min(2, Math.round(index ?? 0)))]];
}
