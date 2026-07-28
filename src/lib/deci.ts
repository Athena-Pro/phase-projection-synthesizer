/**
 * Minimal TypeScript port of the deci-core "base-10 Turing machine".
 *
 * Ported from the deci-core project's `interpreter.js`. This is a self-contained copy of
 * just the pieces the synth needs — the digit-opcode interpreter and the Gödel
 * prime-exponent register view — so the synth stays ESM/Vite-native and testable without
 * pulling in deci-core's global-registering script or its Python API. Keep the opcode
 * semantics in lock-step with that interpreter; its `tests/vectors_interpreter.json` holds
 * the canonical regression vectors.
 *
 * A deci-core program is a string of digits 0–9, each a single opcode operating on
 * one arbitrary-precision accumulator A:
 *
 *   0 HALT      1 A+1        2 A-1 (floored at 0)   3 A×2      4 A×3
 *   5 A÷2 if even else skip next   6 A÷3 if div-by-3 else skip next
 *   7 MIRROR (reverse decimal digits of A)          8 LOOP[   9 LOOP]
 *
 * `8`/`9` are a matched bracket loop: `8` jumps past its `9` when A=0, `9` jumps
 * back to its `8` when A≠0 (a while-A≠0 body).
 */

export interface DeciStepResult {
  step: number;
  op: string | null;
  prevA: bigint;
  newA: bigint;
  halted: boolean;
}

export interface DeciRunResult {
  A: bigint;
  steps: number;
  halted: boolean;
}

export class DeciMachine {
  program: string[] = [];
  ip = 0;
  A = 0n;
  halted = false;
  steps = 0;
  private bracketMap = new Map<number, number>();

  load(code: string, initialA: bigint | number | string = 0n): void {
    this.program = String(code).replace(/[^0-9]/g, '').split('');
    this.ip = 0;
    this.A = toBigInt(initialA);
    this.halted = false;
    this.steps = 0;
    this.bracketMap = new Map();
    this.buildBracketMap();
  }

  private buildBracketMap(): void {
    const stack: number[] = [];
    for (let i = 0; i < this.program.length; i++) {
      if (this.program[i] === '8') {
        stack.push(i);
      } else if (this.program[i] === '9') {
        const j = stack.pop();
        if (j !== undefined) {
          this.bracketMap.set(j, i);
          this.bracketMap.set(i, j);
        }
      }
    }
  }

  step(): DeciStepResult {
    if (this.halted || this.ip >= this.program.length) {
      this.halted = true;
      return { step: this.steps, op: null, prevA: this.A, newA: this.A, halted: true };
    }

    const op = this.program[this.ip];
    const prevA = this.A;
    const prevIP = this.ip;

    switch (op) {
      case '0':
        this.halted = true;
        this.ip++;
        break;
      case '1':
        this.A += 1n;
        this.ip++;
        break;
      case '2':
        if (this.A > 0n) this.A -= 1n;
        this.ip++;
        break;
      case '3':
        this.A *= 2n;
        this.ip++;
        break;
      case '4':
        this.A *= 3n;
        this.ip++;
        break;
      case '5':
        if (this.A % 2n === 0n) {
          this.A /= 2n;
          this.ip++;
        } else {
          this.ip += 2; // odd → skip the next instruction
        }
        break;
      case '6':
        if (this.A % 3n === 0n) {
          this.A /= 3n;
          this.ip++;
        } else {
          this.ip += 2;
        }
        break;
      case '7': {
        const s = this.A.toString();
        this.A = BigInt(s.split('').reverse().join(''));
        this.ip++;
        break;
      }
      case '8':
        if (this.A === 0n) {
          const end = this.bracketMap.get(prevIP);
          this.ip = end != null ? end + 1 : this.program.length;
        } else {
          this.ip++;
        }
        break;
      case '9':
        if (this.A !== 0n) {
          const start = this.bracketMap.get(prevIP);
          this.ip = start != null ? start + 1 : prevIP + 1;
        } else {
          this.ip++;
        }
        break;
      default:
        this.ip++;
    }

    this.steps++;
    return { step: this.steps, op, prevA, newA: this.A, halted: this.halted };
  }

  run(maxSteps = 100000): DeciRunResult {
    while (!this.halted && this.ip < this.program.length && this.steps < maxSteps) {
      this.step();
    }
    return { A: this.A, steps: this.steps, halted: this.halted };
  }
}

/** Run a program on a seed and return only the final state. */
export function runDeci(code: string, seed: bigint, maxSteps = 100000): DeciRunResult {
  const m = new DeciMachine();
  m.load(code, seed);
  return m.run(maxSteps);
}

/**
 * Run a program and sample the accumulator along the way, seed first.
 *
 * Returns exactly `count` values: [seed, …intermediate states…, final A]. The intermediate
 * samples are taken at even step intervals, so the list is the machine's *trajectory* rather
 * than just its answer — which is what a note needs when each of its envelope sections is
 * supposed to sound like a different integer. Programs that halt in fewer steps than there
 * are samples simply repeat their final value.
 */
export function runDeciTrajectory(
  code: string,
  seed: bigint,
  count: number,
  maxSteps = 100000
): { values: bigint[]; steps: number; halted: boolean } {
  const n = Math.max(1, Math.round(count));
  // One sample means the answer, not the question.
  const full = runDeci(code, seed, maxSteps);
  if (n === 1) return { values: [full.A], steps: full.steps, halted: full.halted };

  const m = new DeciMachine();
  m.load(code, seed);
  const values: bigint[] = [seed];
  // n − 1 further samples spaced evenly over the run, the last being its end.
  for (let i = 1; i < n; i++) {
    const target = Math.round((full.steps * i) / (n - 1));
    while (m.steps < target && !m.halted && m.ip < m.program.length) m.step();
    values.push(m.A);
  }
  return { values, steps: full.steps, halted: full.halted };
}

/**
 * Gödel register view of an integer: the exponents of the first six primes in its
 * factorization, plus whatever is left over. A = 2^e0 · 3^e1 · 5^e2 · 7^e3 · 11^e4 ·
 * 13^e5 · remainder. This is deci-core's way of reading several small "registers"
 * out of one packed integer.
 */
export function getGodelRegisters(n: bigint): {
  exponents: number[];
  primes: bigint[];
  remainder: bigint;
} {
  const primes = [2n, 3n, 5n, 7n, 11n, 13n];
  if (n <= 0n) return { exponents: primes.map(() => 0), primes, remainder: n < 0n ? -n : 0n };
  const exps: number[] = [];
  let rem = n;
  for (const p of primes) {
    let e = 0;
    while (rem % p === 0n) {
      e++;
      rem /= p;
    }
    exps.push(e);
  }
  return { exponents: exps, primes, remainder: rem };
}

function toBigInt(val: bigint | number | string): bigint {
  if (typeof val === 'bigint') return val;
  try {
    const s = String(val ?? '0').trim().replace(/\s/g, '');
    return s === '' ? 0n : BigInt(s.split('.')[0]);
  } catch {
    return 0n;
  }
}
