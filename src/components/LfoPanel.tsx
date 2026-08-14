import React from 'react';
import { LfoConfig, LfoShape, StepSeq, DEFAULT_STEPS } from '../lib/lfo';
import { PARAM_SPECS } from '../lib/paramSpecs';
import { Knob, HardwareSection, SegmentGroup } from './ui';

interface LfoPanelProps {
  lfos: LfoConfig[];
  onChange: (index: number, next: LfoConfig) => void;
  armed: number | null;
  onArm: (index: number) => void;
  onTouch: (label: string, display: string) => void;
}

const SHAPES: { id: LfoShape; label: string; hint: string }[] = [
  { id: 'sine', label: '∿', hint: 'Sine' },
  { id: 'tri', label: '⋀', hint: 'Triangle' },
  { id: 'sqr', label: '⊓', hint: 'Square' },
  { id: 's&h', label: '⁘', hint: 'Sample & hold — a new uniformly random value each cycle' },
  { id: 'chaos', label: '⋔', hint: 'Logistic map at r = 3.99 — deterministic chaos, clustered rather than uniform, so it lingers near the rails and darts between them' },
  { id: 'step4', label: '⊞', hint: 'Four-step sequence — a mini sequencer aimed at whichever knob this LFO is assigned to' },
];

/** Shapes that hold a value between edges, so Lag has something to slew across. */
const STEPPED: LfoShape[] = ['sqr', 's&h', 'chaos', 'step4'];

export default function LfoPanel({ lfos, onChange, armed, onArm, onTouch }: LfoPanelProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {lfos.map((lfo, i) => {
        const isArmed = armed === i;
        const targetLabel = lfo.target ? PARAM_SPECS[lfo.target]?.label ?? '—' : '—';
        return (
          <HardwareSection key={i} title={`LFO ${i + 1}`}>
            <div className="flex items-start gap-2">
              {/* Assign button + target readout */}
              <div className="flex flex-col items-center gap-1 shrink-0">
                <button
                  onClick={() => onArm(i)}
                  title={
                    isArmed
                      ? 'Armed — touch a knob to assign, click again to clear'
                      : 'Arm, then touch a knob to assign this LFO'
                  }
                  className="flex flex-col items-center gap-1 cursor-pointer group"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isArmed ? 'led-red animate-pulse' : lfo.target ? 'led-on' : 'led-off'
                    }`}
                  />
                  <span
                    className={`w-9 h-6 rounded-[3px] border flex items-center justify-center transition-colors ${
                      isArmed
                        ? 'bg-alert/25 border-alert/60'
                        : lfo.target
                          ? 'bg-phos/15 border-phos/40'
                          : 'bg-face2 border-silk/25 group-hover:border-silk/50'
                    }`}
                  />
                  <span className="text-[8px] tracking-wider uppercase text-dim">Assign</span>
                </button>
                <span
                  className={`text-[8px] tracking-wider uppercase max-w-[56px] truncate ${
                    lfo.target ? 'text-phos' : 'text-dim'
                  }`}
                  title={targetLabel}
                >
                  {isArmed ? 'touch…' : targetLabel}
                </span>
              </div>

              <Knob
                label="Rate"
                value={lfo.rate}
                min={0.05}
                max={12}
                step={0.05}
                defaultValue={0.5}
                format={(v) => `${v.toFixed(2)}Hz`}
                onChange={(v) => onChange(i, { ...lfo, rate: v })}
                onTouch={(l, d) => onTouch(`LFO${i + 1} ${l}`, d)}
              />
              <Knob
                label="Depth"
                value={lfo.depth}
                min={0}
                max={1}
                step={0.01}
                defaultValue={0}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => onChange(i, { ...lfo, depth: v })}
                onTouch={(l, d) => onTouch(`LFO${i + 1} ${l}`, d)}
              />

              {/* Lag only means something on a staircase, so it appears with one. */}
              {STEPPED.includes(lfo.shape) && (
                <Knob
                  label="Lag"
                  value={lfo.lag ?? 0}
                  min={0}
                  max={0.95}
                  step={0.01}
                  defaultValue={0}
                  format={(v) => (v <= 0 ? 'step' : `${Math.round(v * 100)}%`)}
                  onChange={(v) => onChange(i, { ...lfo, lag: v })}
                  onTouch={(l, d) => onTouch(`LFO${i + 1} ${l}`, d)}
                />
              )}

              <div className="pt-1">
                <SegmentGroup<LfoShape>
                  value={lfo.shape}
                  onChange={(s) => onChange(i, { ...lfo, shape: s })}
                  options={SHAPES}
                />
              </div>
            </div>

            {lfo.shape === 'step4' && (
              <div className="flex flex-wrap gap-x-2 gap-y-1 pt-1.5">
                {[0, 1, 2, 3].map((s) => {
                  const steps = lfo.steps ?? DEFAULT_STEPS;
                  return (
                    <Knob
                      key={s}
                      label={`Step ${s + 1}`}
                      value={steps[s]}
                      min={-1}
                      max={1}
                      step={0.01}
                      defaultValue={DEFAULT_STEPS[s]}
                      format={(v) => v.toFixed(2)}
                      onChange={(v) => {
                        const next = [...steps] as StepSeq;
                        next[s] = v;
                        onChange(i, { ...lfo, steps: next });
                      }}
                      onTouch={(l, d) => onTouch(`LFO${i + 1} ${l}`, d)}
                      size={34}
                    />
                  );
                })}
              </div>
            )}
          </HardwareSection>
        );
      })}
    </div>
  );
}
