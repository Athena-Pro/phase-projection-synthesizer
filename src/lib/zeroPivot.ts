/**
 * Zero-crossing pivot transform.
 *
 * The cycle is cut at its zero crossings — the points where the trajectory state
 * [f : f'] passes through [0 : 1], so any splice there preserves continuity.
 */
export function applyZeroPivotTransform(
  samples: number[],
  stretch: number,
  insert: number
): number[] {
  if (stretch < 0.001 && insert < 0.001) return samples;
  const K = samples.length;

  const crossings: number[] = [];
  for (let i = 0; i < K; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % K];
    if ((a <= 0 && b > 0) || (a >= 0 && b < 0)) crossings.push((i + 1) % K);
  }
  if (crossings.length < 2) return samples;

  const segs: number[][] = [];
  for (let c = 0; c < crossings.length; c++) {
    const start = crossings[c];
    const end = crossings[(c + 1) % crossings.length];
    const seg: number[] = [];
    let i = start;
    while (i !== end) {
      seg.push(samples[i]);
      i = (i + 1) % K;
    }
    if (seg.length > 1) segs.push(seg);
  }
  if (segs.length < 2) return samples;

  const sampleSeg = (seg: number[], pos: number): number => {
    const i0 = Math.floor(pos);
    const i1 = Math.min(seg.length - 1, i0 + 1);
    const fr = pos - i0;
    return seg[i0] * (1 - fr) + seg[i1] * fr;
  };

  const power = 1 / (1 + 3 * stretch);
  const warped: number[] = [];
  for (const seg of segs) {
    const L = seg.length;
    for (let j = 0; j < L; j++) {
      const t = j / (L - 1);
      const x = 2 * t - 1;
      const w = 0.5 * (1 + Math.sign(x) * Math.pow(Math.abs(x), power));
      warped.push(sampleSeg(seg, w * (L - 1)));
    }
    if (insert > 0.001) {
      const insLen = Math.max(2, Math.round(L * insert));
      for (let j = 0; j < insLen; j++) {
        const t = j / (insLen - 1);
        warped.push(-insert * sampleSeg(seg, (1 - t) * (L - 1)));
      }
    }
  }

  const M = warped.length;
  const resampled = new Array<number>(K);
  for (let j = 0; j < K; j++) {
    const pos = (j / K) * M;
    const i0 = Math.floor(pos) % M;
    const i1 = (i0 + 1) % M;
    const fr = pos - Math.floor(pos);
    resampled[j] = warped[i0] * (1 - fr) + warped[i1] * fr;
  }

  const offset = crossings[0];
  const out = new Array<number>(K);
  for (let j = 0; j < K; j++) out[(j + offset) % K] = resampled[j];
  return out;
}
