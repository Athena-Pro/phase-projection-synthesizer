import React from 'react';
import { Looper } from '../lib/looper';

interface LooperPanelProps {
  looper: Looper | null;
  looperState: { isRecording: boolean; isPlaying: boolean; events: number; duration: number };
}

export function LooperPanel({ looper, looperState }: LooperPanelProps) {
  if (!looper) return null;

  return (
    <div className="flex flex-col gap-2 p-3 bg-black/40 border border-silk/20 rounded-sm">
      <div className="text-[10px] uppercase tracking-widest text-silk/60 flex justify-between">
        <span>Performance Looper</span>
        <span>{looperState.events} events | {(looperState.duration / 1000).toFixed(1)}s</span>
      </div>
      <div className="flex gap-2">
        <button
          className={`flex-1 py-2 text-xs font-bold rounded-sm transition-colors ${
            looperState.isRecording
              ? 'bg-red-500/80 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]'
              : 'bg-silk/10 text-silk hover:bg-silk/20'
          }`}
          onClick={() => looper.toggleRecord()}
        >
          {looperState.isRecording ? '• RECORDING' : '• RECORD / DUB'}
        </button>
        <button
          className={`flex-1 py-2 text-xs font-bold rounded-sm transition-colors ${
            looperState.isPlaying
              ? 'bg-phos/80 text-black shadow-[0_0_15px_rgba(88,255,141,0.5)]'
              : 'bg-silk/10 text-silk hover:bg-silk/20'
          }`}
          onClick={() => looper.togglePlay()}
        >
          {looperState.isPlaying ? '▶ PLAYING' : '▶ PLAY'}
        </button>
        <button
          className="flex-1 py-2 text-xs font-bold bg-silk/10 text-silk hover:bg-silk/20 rounded-sm transition-colors"
          onClick={() => looper.clear()}
        >
          CLEAR
        </button>
      </div>
    </div>
  );
}
