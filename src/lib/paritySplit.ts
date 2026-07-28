/**
 * Bias-parity split — the waveform's upper and lower rails through separate effects.
 *
 * The signal is partitioned by the sign of (x − bias): the upper rail keeps the part
 * above the bias line, the lower rail the part below it.
 *
 *   u = max(x − b, 0)     // upper rail  (positive parity, ≥ 0)
 *   l = min(x − b, 0)     // lower rail  (negative parity, ≤ 0)
 *   x = b + u + l         // identity channels reconstruct x exactly
 *
 * So `parity = sign(x − b)` and the two rails are its ±1 regions; sweeping the bias
 * slides the split line and continuously reassigns the wave between the two channels.
 * This is the amplitude sibling of the zero-crossing pivot, which cuts at x = 0; here
 * we partition by x ≷ b and route each region to its own effect channel.
 *
 * A master-bus send (the dry path is untouched): each rail is produced by a 4×
 * oversampled WaveShaper — its curve bakes in the bias, and oversampling tames the
 * aliasing from the hard corner at the split line. Each rail then runs through its own
 * tanh drive and a per-rail voice:
 *
 *   - a resonant lowpass "tone", and
 *   - a formant (vowel) bank of three bandpass resonators tracking F1/F2/F3,
 *
 * cross-faded by `formant`. So with formants engaged the peaks can speak one vowel while
 * the troughs speak another, and sweeping the bias trades the vowels across the wave.
 * Each rail's `vowel` control morphs continuously through A–E–I–O–U. The two channels
 * are summed, DC-blocked (the rails are unipolar, so each carries an offset), and
 * returned at the mix level.
 *
 * The upper rail (the peaks) also feeds a separate `upperSend` output, which the engine
 * routes into the Doppler reverb: the peaks are reverberated in the moving-wall room
 * while the troughs stay in the driven/voiced channel.
 */

export interface ParityParams {
  mix: number; // 0..1 wet return level (0 = bypassed)
  bias: number; // -1..1 split line
  toneUp: number; // Hz — upper-channel resonant lowpass
  toneDn: number; // Hz — lower-channel resonant lowpass
  drive: number; // 0..1 — tanh drive shared by both channels
  reso: number; // 0..1 — resonance (Q) of the tone lowpass and the formant bank
  reverb: number; // 0..1 — amount of the upper rail sent to the Doppler reverb
  formant: number; // 0..1 — cross-fade each rail from its tone lowpass to its vowel bank
  vowelUp: number; // 0..1 — upper-rail vowel morph position (A→E→I→O→U)
  vowelDn: number; // 0..1 — lower-rail vowel morph position
  keyTrack: number; // 0..1 — amount formants follow the active note
  pitchRatio: number; // active-note frequency / C3 frequency
}

const LUT = 2048;
const NFORM = 3; // formants per vowel (F1, F2, F3)

// Average male vowel formants (Peterson & Barney): [F1,F2,F3] Hz, and relative gains.
const VOWELS: { f: number[]; g: number[] }[] = [
  { f: [730, 1090, 2440], g: [1.0, 0.3, 0.15] }, // A  (father)
  { f: [530, 1840, 2480], g: [1.0, 0.3, 0.18] }, // E  (bed)
  { f: [270, 2290, 3010], g: [1.0, 0.25, 0.18] }, // I  (beet)
  { f: [570, 840, 2410], g: [1.0, 0.4, 0.12] }, // O  (bought)
  { f: [300, 870, 2240], g: [1.0, 0.35, 0.1] }, // U  (boot)
];
const FORMANT_Q = [8, 10, 12]; // base sharpness per formant
const FORMANT_MAKEUP = 3.0; // narrow bandpasses read quiet — lift to match the tone path

/** Interpolate the vowel formants at morph position v01 ∈ [0,1] across A→E→I→O→U. */
function vowelAt(v01: number): { f: number[]; g: number[] } {
  const pos = Math.max(0, Math.min(1, v01)) * (VOWELS.length - 1);
  const i = Math.min(VOWELS.length - 2, Math.floor(pos));
  const fr = pos - i;
  const a = VOWELS[i];
  const b = VOWELS[i + 1];
  const f: number[] = [];
  const g: number[] = [];
  for (let k = 0; k < NFORM; k++) {
    f.push(a.f[k] + (b.f[k] - a.f[k]) * fr);
    g.push(a.g[k] + (b.g[k] - a.g[k]) * fr);
  }
  return { f, g };
}

/** WaveShaper curve for one rail: max(v − b, 0) (upper) or min(v − b, 0) (lower). */
function splitCurve(bias: number, upper: boolean): Float32Array {
  const c = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const v = (i / (LUT - 1)) * 2 - 1; // WaveShaper maps input [-1,1] across the LUT
    const s = v - bias;
    c[i] = upper ? Math.max(s, 0) : Math.min(s, 0);
  }
  return c;
}

/** Normalized tanh drive curve. drive 0 → near-linear, 1 → hard saturation. */
function driveCurve(drive: number): Float32Array {
  const k = 1 + drive * 20;
  const norm = Math.tanh(k);
  const c = new Float32Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const v = (i / (LUT - 1)) * 2 - 1;
    c[i] = Math.tanh(k * v) / norm;
  }
  return c;
}

/** One rail's voice: a resonant lowpass and a 3-band formant bank, cross-faded. */
interface RailVoice {
  drive: WaveShaperNode;
  tone: BiquadFilterNode; // resonant lowpass
  toneGain: GainNode; // 1 − formant
  bands: BiquadFilterNode[]; // formant bandpasses
  bandGains: GainNode[];
  formantGain: GainNode; // formant
  mix: GainNode; // rail output (tone + formant)
}

export class ParitySplit {
  /** Tap the master signal here (a send from the filtered bus). */
  readonly input: GainNode;
  /** Wet output — add to the master bus. */
  readonly output: GainNode;
  /** Upper rail (peaks) send — the engine routes this into the Doppler reverb. */
  readonly upperSend: GainNode;

  private ctx: AudioContext;
  private shaperUp: WaveShaperNode;
  private shaperDn: WaveShaperNode;
  private up: RailVoice;
  private dn: RailVoice;
  private wet: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.upperSend = ctx.createGain();
    this.upperSend.gain.value = 0;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;

    const mkShaper = () => {
      const w = ctx.createWaveShaper();
      w.oversample = '4x'; // the split corner is a discontinuity — oversample it
      return w;
    };
    this.shaperUp = mkShaper();
    this.shaperDn = mkShaper();

    const mkVoice = (): RailVoice => {
      const drive = mkShaper();
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const toneGain = ctx.createGain();
      const formantGain = ctx.createGain();
      const mix = ctx.createGain();
      const bands: BiquadFilterNode[] = [];
      const bandGains: GainNode[] = [];

      // tone path: drive → lowpass → toneGain → mix
      drive.connect(tone);
      tone.connect(toneGain);
      toneGain.connect(mix);

      // formant path: drive → [bandpass_k → bandGain_k] → formantGain → mix
      for (let k = 0; k < NFORM; k++) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        const bg = ctx.createGain();
        drive.connect(bp);
        bp.connect(bg);
        bg.connect(formantGain);
        bands.push(bp);
        bandGains.push(bg);
      }
      formantGain.connect(mix);

      return { drive, tone, toneGain, bands, bandGains, formantGain, mix };
    };

    this.up = mkVoice();
    this.dn = mkVoice();

    // DC blocker: the rails are unipolar, so each channel carries an offset.
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 18;
    dcBlock.Q.value = 0.7;

    this.input.connect(this.shaperUp);
    this.shaperUp.connect(this.up.drive);
    this.up.mix.connect(this.wet);
    this.up.mix.connect(this.upperSend); // voiced peaks → Doppler reverb (wired by engine)

    this.input.connect(this.shaperDn);
    this.shaperDn.connect(this.dn.drive);
    this.dn.mix.connect(this.wet);

    this.wet.connect(dcBlock);
    dcBlock.connect(this.output);

    this.setParams({
      mix: 0,
      bias: 0,
      toneUp: 6000,
      toneDn: 1200,
      drive: 0.3,
      reso: 0.2,
      reverb: 0,
      formant: 0,
      vowelUp: 0,
      vowelDn: 0.5,
      keyTrack: 0,
      pitchRatio: 1,
    });
  }

  private tuneVoice(v: RailVoice, tone: number, vowel: number, p: ParityParams) {
    const t = this.ctx.currentTime;
    v.tone.frequency.setTargetAtTime(tone, t, 0.03);
    v.tone.Q.setTargetAtTime(0.7 + p.reso * 13, t, 0.03);

    const { f, g } = vowelAt(vowel);
    const trackedRatio = Math.pow(Math.max(0.25, Math.min(4, p.pitchRatio)), p.keyTrack);
    const qScale = 0.7 + p.reso * 1.3;
    for (let k = 0; k < NFORM; k++) {
      const trackedFrequency = Math.max(80, Math.min(12000, f[k] * trackedRatio));
      v.bands[k].frequency.setTargetAtTime(trackedFrequency, t, 0.03);
      v.bands[k].Q.setTargetAtTime(FORMANT_Q[k] * qScale, t, 0.03);
      v.bandGains[k].gain.setTargetAtTime(g[k] * FORMANT_MAKEUP, t, 0.03);
    }
    // Cross-fade tone ↔ formant
    v.toneGain.gain.setTargetAtTime(1 - p.formant, t, 0.03);
    v.formantGain.gain.setTargetAtTime(p.formant, t, 0.03);
  }

  setParams(p: ParityParams) {
    const t = this.ctx.currentTime;
    this.shaperUp.curve = splitCurve(p.bias, true);
    this.shaperDn.curve = splitCurve(p.bias, false);
    const dc = driveCurve(p.drive);
    this.up.drive.curve = dc;
    this.dn.drive.curve = dc;

    this.tuneVoice(this.up, p.toneUp, p.vowelUp, p);
    this.tuneVoice(this.dn, p.toneDn, p.vowelDn, p);

    this.upperSend.gain.setTargetAtTime(p.reverb, t, 0.03);
    this.wet.gain.setTargetAtTime(p.mix, t, 0.02);
  }
}
