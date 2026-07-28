/**
 * Doppler reverb — regime 2: traveling walls (shimmer).
 *
 * Regime 1 oscillates the walls, so the shift reverses each half-cycle and the tuning
 * stays centered. Here the walls travel steadily, which is a *fixed* Doppler shift —
 * and because that shift lives inside the feedback loop, it compounds: content that has
 * gone around k times has been transposed ρ^k. The tail spirals continuously upward
 * (approaching walls, ρ>1) or downward (receding, ρ<1) — a Risset/shimmer reverb whose
 * pitch glide is derived from room physics rather than a pitch-shifter bolted on.
 *
 * The compounding is exactly the rapidity addition of the ambisonic dominance section:
 * (c−v)/(c+v) = e^{−2·artanh(v/c)}, so each loop pass adds a constant on the
 * log-frequency line — a hyperbolic boost of frequency, the temporal sibling of the
 * spatial boost that moves apparent directions.
 *
 * DSP: a 4-line Householder feedback delay network (the diffusing "tank"), with a
 * constant-power dual-tap delay-line pitch shifter inserted on the recirculating path.
 * A steady read-pointer ramp gives the fixed shift; the two taps, offset by half the
 * window and cross-faded with sin/cos weights, let the delay ramp forever without the
 * pointer running off the buffer. A damping lowpass in the loop tames the upward runaway
 * (rising partials eventually climb into the lowpass stopband and die), and a tanh
 * soft-clip on the feedback write bounds the network unconditionally.
 *
 * Protocol (port messages):
 *   { type: 'params', shift (semitones), feedback (0..1), size (0..1), damp (0..1) }
 */
const processorSource = `
const N = 4;
// Coprime-ish base delays (seconds) so the tank's modes never align.
const BASE = [0.0431, 0.0537, 0.0667, 0.0776];

class DopplerShimmer extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.Lmax = Math.ceil(0.25 * sr) + 4;
    this.bufs = [];
    this.lp = new Float64Array(N);
    this.delayLen = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      this.bufs.push(new Float32Array(this.Lmax));
      this.delayLen[i] = BASE[i] * sr;
    }
    this.w = 0;

    // Pitch-shifter state (dual-tap, constant power)
    this.W = Math.floor(0.040 * sr); // 40 ms window
    this.Plen = this.W + 4;
    this.pbuf = new Float32Array(this.Plen);
    this.pw = 0;
    this.pd = 0; // read-pointer ramp position in [0, W)

    // Smoothed control targets
    this.rho = 1;        this.tRho = 1;
    this.gShim = 0;      this.tGShim = 0;
    this.dampA = 0.3;    this.tDampA = 0.3;
    this.tDelay = this.delayLen.slice();
    this.gDiff = 0.5;    // fixed internal diffusion density

    this.alive = true;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'params') {
        this.tRho = Math.pow(2, d.shift / 12);
        this.tGShim = d.feedback * 0.88;
        const sizeScale = 0.4 + d.size * 1.8;
        for (let i = 0; i < N; i++) this.tDelay[i] = BASE[i] * sampleRate * sizeScale;
        const fc = 800 + (1 - d.damp) * 15000;
        this.tDampA = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
      } else if (d.type === 'stop') {
        this.alive = false;
      }
    };
  }

  cread(buf, pos, len) {
    let p = pos % len;
    if (p < 0) p += len;
    const i0 = Math.floor(p);
    const i1 = (i0 + 1) % len;
    const fr = p - i0;
    return buf[i0] * (1 - fr) + buf[i1] * fr;
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0];
    const out = outputs[0];
    const outL = out[0];
    const outR = out[1] || out[0];
    const n = outL.length;

    // Per-block control smoothing (one-pole, ~ a few ms)
    const sm = 0.15;
    this.rho += (this.tRho - this.rho) * sm;
    this.gShim += (this.tGShim - this.gShim) * sm;
    this.dampA += (this.tDampA - this.dampA) * sm;
    for (let i = 0; i < N; i++) this.delayLen[i] += (this.tDelay[i] - this.delayLen[i]) * sm;

    const shiftOn = Math.abs(1 - this.rho) > 1e-4;
    const W = this.W;
    const halfW = W * 0.5;
    const PI = Math.PI;
    const gDiff = this.gDiff;
    const gShim = this.gShim;
    const a = this.dampA;

    for (let s = 0; s < n; s++) {
      let x = 0;
      if (input && input.length) {
        const c0 = input[0];
        const c1 = input[1];
        x = c1 ? 0.5 * (c0[s] + c1[s]) : (c0 ? c0[s] : 0);
      }

      // Read + damp each delay line
      let t0 = this.cread(this.bufs[0], this.w - this.delayLen[0], this.Lmax);
      let t1 = this.cread(this.bufs[1], this.w - this.delayLen[1], this.Lmax);
      let t2 = this.cread(this.bufs[2], this.w - this.delayLen[2], this.Lmax);
      let t3 = this.cread(this.bufs[3], this.w - this.delayLen[3], this.Lmax);
      this.lp[0] += a * (t0 - this.lp[0]); t0 = this.lp[0];
      this.lp[1] += a * (t1 - this.lp[1]); t1 = this.lp[1];
      this.lp[2] += a * (t2 - this.lp[2]); t2 = this.lp[2];
      this.lp[3] += a * (t3 - this.lp[3]); t3 = this.lp[3];

      const wet = 0.5 * (t0 + t1 + t2 + t3);

      // Pitch-shift the tank output for the recirculating shimmer path
      let sh;
      this.pbuf[this.pw] = wet;
      if (shiftOn) {
        const readA = this.pw - this.pd;
        let dB = this.pd + halfW; if (dB >= W) dB -= W;
        const readB = this.pw - dB;
        const A = this.cread(this.pbuf, readA, this.Plen);
        const B = this.cread(this.pbuf, readB, this.Plen);
        const x0 = this.pd / W;
        let xB = x0 + 0.5; if (xB >= 1) xB -= 1;
        const gA = Math.sin(PI * x0);
        const gB = Math.sin(PI * xB);
        sh = gA * A + gB * B;
        this.pd += (1 - this.rho); // ramp: ρ>1 shrinks delay (up), ρ<1 grows it (down)
        if (this.pd >= W) this.pd -= W;
        if (this.pd < 0) this.pd += W;
      } else {
        sh = wet;
      }
      this.pw++; if (this.pw >= this.Plen) this.pw = 0;

      // Householder diffusion: hm[i] = td[i] − 0.5·Σtd  (H = I − 2/N·J)
      const S = 0.5 * (t0 + t1 + t2 + t3);
      const shTerm = gShim * sh;
      // tanh soft-clip bounds the loop no matter the feedback
      this.bufs[0][this.w] = Math.tanh(x + gDiff * (t0 - S) + shTerm);
      this.bufs[1][this.w] = Math.tanh(x + gDiff * (t1 - S) + shTerm);
      this.bufs[2][this.w] = Math.tanh(x + gDiff * (t2 - S) + shTerm);
      this.bufs[3][this.w] = Math.tanh(x + gDiff * (t3 - S) + shTerm);
      this.w++; if (this.w >= this.Lmax) this.w = 0;

      outL[s] = wet;
      outR[s] = wet;
    }
    return true;
  }
}
registerProcessor('doppler-shimmer', DopplerShimmer);
`;

let workletUrl: string | null = null;

export function getShimmerWorkletUrl(): string {
  if (!workletUrl) {
    workletUrl = URL.createObjectURL(
      new Blob([processorSource], { type: 'application/javascript' })
    );
  }
  return workletUrl;
}
