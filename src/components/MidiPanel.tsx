import React from 'react';
import { HardwareSection } from './ui';

interface MidiPanelProps {
  deviceName: string | null;
  enabled: boolean;
  knobsEnabled: boolean;
  learnActive: boolean;
  onToggleEnabled: () => void;
  onToggleKnobs: () => void;
  onToggleLearn: () => void;
}

/** Small toggle styled like the faceplate's LINK switch. */
function Toggle({
  label,
  on,
  onClick,
  title,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex flex-col items-center gap-1 cursor-pointer group select-none"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'led-on' : 'led-off'}`} />
      <span
        className={`px-1.5 h-5 rounded-[3px] border flex items-center text-[8px] uppercase tracking-wider transition-colors ${
          on
            ? 'bg-phos/15 border-phos/50 text-phos'
            : 'bg-face2 border-silk/25 text-dim group-hover:border-silk/50'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export default function MidiPanel({
  deviceName,
  enabled,
  knobsEnabled,
  learnActive,
  onToggleEnabled,
  onToggleKnobs,
  onToggleLearn,
}: MidiPanelProps) {
  return (
    <HardwareSection title="MIDI · FLKey">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 min-w-[120px]">
          <span className={`w-1.5 h-1.5 rounded-full ${deviceName ? 'led-on' : 'led-off'}`} />
          <span className="text-[8px] uppercase tracking-wider text-dim truncate max-w-[140px]">
            {deviceName || 'no controller'}
          </span>
        </div>

        <Toggle
          label="MIDI"
          on={enabled}
          onClick={onToggleEnabled}
          title="Master enable for the FLKey control layer"
        />
        <Toggle
          label="Knobs"
          on={knobsEnabled}
          onClick={onToggleKnobs}
          title="Route the 8 top knobs to synth parameters. Turn off to hand the physical knobs to FL Studio's own automation."
        />
        <Toggle
          label="Learn"
          on={learnActive}
          onClick={onToggleLearn}
          title="MIDI-learn: touch a synth knob, then move a hardware control to bind it"
        />

        <span className="text-[8px] uppercase tracking-wider text-dim leading-tight max-w-[220px]">
          {learnActive
            ? 'touch a knob, then move a hardware control'
            : 'pitch · mod · 8 knobs · presets · nav · play'}
        </span>
      </div>
    </HardwareSection>
  );
}
