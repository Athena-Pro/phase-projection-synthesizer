import React, { useRef } from 'react';

/** Panel section with silkscreen border and an engraved title notch. */
export function HardwareSection({
  title,
  children,
  className = '',
  dense = false,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Tighter padding for compact/VST-density layouts. */
  dense?: boolean;
}) {
  return (
    <fieldset
      className={`relative border border-silk/25 rounded-sm ${
        dense ? 'px-2 pt-2 pb-1' : 'px-3 pt-3 pb-2'
      } ${className}`}
    >
      <legend className="px-1.5 text-[9px] tracking-[0.22em] uppercase text-silk/80 select-none">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Rotary knob. Drag vertically to change (hold Shift for fine control),
 * double-click to reset to defaultValue.
 */
export function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  onTouch,
  defaultValue,
  size = 42,
  focused = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  onTouch?: (label: string, display: string) => void;
  defaultValue?: number;
  size?: number;
  /** Field-navigation focus (driven by the controller's nav keys). */
  focused?: boolean;
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null);

  const quantize = (v: number) => {
    const q = Math.round((v - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(q.toFixed(6))));
  };

  const apply = (v: number) => {
    const q = quantize(v);
    if (q !== value) {
      onChange(q);
      onTouch?.(label, format(q));
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch (_) {
      // Synthetic events have no active pointer to capture; drag still works
    }
    drag.current = { startY: e.clientY, startValue: value };
    onTouch?.(label, format(value));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const range = max - min;
    const fine = e.shiftKey ? 0.15 : 1;
    const dv = ((drag.current.startY - e.clientY) / 160) * range * fine;
    apply(drag.current.startValue + dv);
  };

  const handlePointerUp = () => {
    drag.current = null;
  };

  const handleDoubleClick = () => {
    if (defaultValue !== undefined) {
      onChange(quantize(defaultValue));
      onTouch?.(label, format(quantize(defaultValue)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let next: number | undefined;
    const largeStep = step * 10;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next = value + step;
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next = value - step;
    if (e.key === 'PageUp') next = value + largeStep;
    if (e.key === 'PageDown') next = value - largeStep;
    if (e.key === 'Home') next = min;
    if (e.key === 'End') next = max;
    if (next === undefined) return;
    e.preventDefault();
    apply(next);
  };

  // Guard: a non-finite value (or a degenerate range) must never reach SVG coords.
  const rawFrac = (value - min) / (max - min);
  const frac = Number.isFinite(rawFrac) ? Math.min(1, Math.max(0, rawFrac)) : 0;
  const angle = -135 + 270 * frac;
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const R = 19;

  // Tick marks around the sweep
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = rad(-135 + (270 * i) / 10);
    return {
      x1: 24 + Math.cos(a) * (R + 1),
      y1: 24 + Math.sin(a) * (R + 1),
      x2: 24 + Math.cos(a) * (R + 3.5),
      y2: 24 + Math.sin(a) * (R + 3.5),
    };
  });

  const pa = rad(angle);

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      onKeyDown={handleKeyDown}
      className={`flex flex-col items-center gap-0.5 select-none rounded-md transition-shadow focus:outline-none focus:ring-1 focus:ring-phos/70 ${
        focused ? 'ring-1 ring-phos/70 shadow-[0_0_8px_rgba(88,255,141,0.4)]' : ''
      }`}
      title={format(value)}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        className="cursor-ns-resize touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke="rgba(185,190,178,0.4)"
            strokeWidth="1"
          />
        ))}
        {/* Value arc */}
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          stroke="rgba(88,255,141,0.25)"
          strokeWidth="2"
          strokeDasharray={`${(2 * Math.PI * R * (270 * frac)) / 360} ${2 * Math.PI * R}`}
          transform="rotate(135 24 24)"
        />
        {/* Cap */}
        <circle cx="24" cy="24" r="14" fill="#1c1f24" stroke="#000" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="14" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="0.75" />
        {/* Pointer */}
        <line
          x1={24 + Math.cos(pa) * 4}
          y1={24 + Math.sin(pa) * 4}
          x2={24 + Math.cos(pa) * 12.5}
          y2={24 + Math.sin(pa) * 12.5}
          stroke="#58ff8d"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ filter: 'drop-shadow(0 0 2px rgba(88,255,141,0.7))' }}
        />
      </svg>
      <span className="text-[8px] tracking-wider uppercase text-dim leading-tight text-center max-w-[64px]">
        {label}
      </span>
    </div>
  );
}

/** Square hardware button with an LED above it. */
export function HardwareButton({
  label,
  lit,
  color = 'green',
  onClick,
  title,
}: {
  label: string;
  lit?: boolean;
  color?: 'green' | 'red';
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex flex-col items-center gap-1 cursor-pointer group select-none"
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          lit ? (color === 'red' ? 'led-red' : 'led-on') : 'led-off'
        }`}
      />
      <span
        className={`w-9 h-7 rounded-[3px] border transition-colors flex items-center justify-center ${
          lit
            ? color === 'red'
              ? 'bg-alert/25 border-alert/60'
              : 'bg-phos/20 border-phos/50'
            : 'bg-face2 border-silk/25 group-hover:border-silk/50'
        }`}
      />
      <span className="text-[8px] tracking-wider uppercase text-dim">{label}</span>
    </button>
  );
}

/** Row of mutually exclusive switches with LED indicators. */
export function SegmentGroup<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.id)}
          className="flex flex-col items-center gap-0.5 cursor-pointer select-none"
        >
          <span
            className={`w-1 h-1 rounded-full ${value === o.id ? 'led-on' : 'led-off'}`}
          />
          <span
            className={`px-1.5 py-0.5 rounded-[2px] border text-[8px] uppercase tracking-wider transition-colors ${
              value === o.id
                ? 'border-phos/50 text-phos'
                : 'border-silk/20 text-dim hover:text-label'
            }`}
          >
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}
