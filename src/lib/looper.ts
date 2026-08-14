import { AudioEngine } from './audioEngine';

export interface LoopEvent {
  time: number; // ms since loop start
  type: 'noteOn' | 'noteOff' | 'kick' | 'shaker' | 'crash';
  note?: number;
}

export class Looper {
  private engine: AudioEngine;
  private isRecording = false;
  private isPlaying = false;
  private loopStart = 0;
  private loopDuration = 0;
  private events: LoopEvent[] = [];
  private playbackInterval: any = null;
  private currentPlaybackIndex = 0;
  private activeNotes: Set<number> = new Set();
  
  public onStateChange?: (state: { isRecording: boolean; isPlaying: boolean; events: number; duration: number }) => void;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  public recordEvent(type: LoopEvent['type'], note?: number) {
    if (!this.isRecording) return;
    const time = Date.now() - this.loopStart;
    this.events.push({ time, type, note });
    this.emitState();
  }

  public toggleRecord() {
    if (this.isRecording) {
      // Stop recording
      this.isRecording = false;
      this.loopDuration = Date.now() - this.loopStart;
      this.startPlayback();
    } else {
      // Start recording
      if (this.events.length === 0) {
        this.loopStart = Date.now();
      } else {
        // Overdubbing
        this.loopStart = Date.now() - (Date.now() % this.loopDuration);
      }
      this.isRecording = true;
      if (!this.isPlaying && this.events.length > 0) {
        this.startPlayback();
      }
    }
    this.emitState();
  }

  public togglePlay() {
    if (this.isPlaying) {
      this.stopPlayback();
    } else {
      if (this.events.length > 0) {
        this.startPlayback();
      }
    }
    this.emitState();
  }

  public clear() {
    this.stopPlayback();
    this.isRecording = false;
    this.events = [];
    this.loopDuration = 0;
    this.emitState();
  }

  private startPlayback() {
    if (this.loopDuration <= 0) return;
    this.isPlaying = true;
    this.currentPlaybackIndex = 0;
    
    // Simple polling loop for playback (in a real app, you'd use a Web Audio scheduled lookahead,
    // but for UI/MIDI-level events, setInterval works okay)
    const startTime = Date.now();
    
    this.playbackInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - startTime) % this.loopDuration;
      
      // We need to play any events that fall between the last tick and now
      // This is a naive implementation that triggers based on elapsed time.
      for (let i = 0; i < this.events.length; i++) {
        const ev = this.events[i];
        const lastElapsed = (now - 20 - startTime) % this.loopDuration;
        
        // Did we cross the event time?
        let shouldPlay = false;
        if (lastElapsed < elapsed) {
          shouldPlay = ev.time >= lastElapsed && ev.time < elapsed;
        } else {
          // Loop wrapped around
          shouldPlay = ev.time >= lastElapsed || ev.time < elapsed;
        }

        if (shouldPlay) {
          this.playEvent(ev);
        }
      }
    }, 20);
  }

  private stopPlayback() {
    this.isPlaying = false;
    if (this.playbackInterval) {
      clearInterval(this.playbackInterval);
      this.playbackInterval = null;
    }
    
    // All notes off
    this.activeNotes.forEach(n => this.engine.noteOff(n));
    this.activeNotes.clear();
  }

  private playEvent(ev: LoopEvent) {
    if (ev.type === 'noteOn' && ev.note !== undefined) {
      const freq = 440 * Math.pow(2, (ev.note - 69) / 12);
      this.engine.noteOn(ev.note, freq);
      this.activeNotes.add(ev.note);
    } else if (ev.type === 'noteOff' && ev.note !== undefined) {
      this.engine.noteOff(ev.note);
      this.activeNotes.delete(ev.note);
    } else if (ev.type === 'kick') {
      this.engine.triggerKick();
    } else if (ev.type === 'shaker') {
      this.engine.triggerShaker();
    } else if (ev.type === 'crash') {
      this.engine.triggerCrash();
    }
  }

  private emitState() {
    if (this.onStateChange) {
      this.onStateChange({
        isRecording: this.isRecording,
        isPlaying: this.isPlaying,
        events: this.events.length,
        duration: this.loopDuration
      });
    }
  }
}
