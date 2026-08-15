/** Domains in which a mathematical operator acts. */
export type OperatorDomain = 'cycle' | 'spectrum' | 'projective' | 'voice';

export interface OperatorProperties {
  invertible: boolean;
  preservesMagnitude: boolean;
  preservesEnergy: boolean;
}

/**
 * A typed pipeline node. The state and parameter types stay generic so the same calculus
 * can describe cycle surgery now and spectral/projective/voice operators as they are
 * extracted from the engine.
 */
export interface SpectralOperator<State, Params> {
  id: string;
  label: string;
  domain: OperatorDomain;
  properties: OperatorProperties;
  apply(state: State, params: Params): State;
}

export interface OperatorTrace<State> {
  operator: SpectralOperator<State, unknown>;
  before: State;
  after: State;
}

/** Execute a patch as an inspectable operator program, left to right. */
export function runOperatorPipeline<State, Params>(
  initial: State,
  operators: readonly SpectralOperator<State, Params>[],
  params: Params
): State {
  return operators.reduce((state, operator) => operator.apply(state, params), initial);
}

/** A(B(x)) and B(A(x)); subtraction belongs to the state's representation. */
export function composeBothOrders<State, Params>(
  initial: State,
  a: SpectralOperator<State, Params>,
  b: SpectralOperator<State, Params>,
  params: Params
): { ab: State; ba: State } {
  return {
    ab: a.apply(b.apply(initial, params), params),
    ba: b.apply(a.apply(initial, params), params),
  };
}
