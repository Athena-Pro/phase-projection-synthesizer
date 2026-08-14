import { Motion } from '@capacitor/motion';
import { AudioEngine } from './audioEngine';
import { SynthParams } from '../types';
import { PARAM_SPECS } from './paramSpecs';

let isRunning = false;
let shakeTime = 0;
let lastKickTime = 0;
let lastCrashTime = 0;

let gravityX = 0, gravityY = 0, gravityZ = 0;

export async function startMotionDetection(
  onKick: () => void,
  onShaker: () => void,
  onCrash: () => void,
  onTilt?: (pitch: number, roll: number) => void
) {
  if (isRunning) return;
  isRunning = true;

  try {
    if ((Motion as any).requestPermissions) {
      await (Motion as any).requestPermissions();
    }

    Motion.addListener('accel', (event) => {
      const now = Date.now();
      
      const rawAccel = event.acceleration || event.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
      const { x, y, z } = rawAccel;
      
      // High-pass filter to remove gravity
      const alpha = 0.8;
      gravityX = alpha * gravityX + (1 - alpha) * x;
      gravityY = alpha * gravityY + (1 - alpha) * y;
      gravityZ = alpha * gravityZ + (1 - alpha) * z;

      const linearX = x - gravityX;
      const linearY = y - gravityY;
      const linearZ = z - gravityZ;
      
      const mag = Math.sqrt(linearX * linearX + linearY * linearY + linearZ * linearZ);

      if (Math.abs(linearZ) > 8 || mag > 15) {
        if (now - lastKickTime > 200) {
          onKick();
          lastKickTime = now;
        }
      }

      if (mag > 4 && mag < 15) {
        if (now - shakeTime > 150) {
          onShaker();
          shakeTime = now;
        }
      }

      const rot = event.rotationRate || { alpha: 0, beta: 0, gamma: 0 };
      const rotMag = Math.sqrt(rot.alpha * rot.alpha + rot.beta * rot.beta + rot.gamma * rot.gamma);
      if (rotMag > 600 || mag > 25) {
        if (now - lastCrashTime > 500) {
          onCrash();
          lastCrashTime = now;
        }
      }
    });

    Motion.addListener('orientation', (event) => {
      // event.alpha, event.beta, event.gamma
      // Map these to a -1 to 1 range for the UI to consume
      if (onTilt) {
        // beta is front-to-back tilt [-180, 180]
        // gamma is left-to-right tilt [-90, 90]
        const pitch = Math.max(-1, Math.min(1, event.beta / 90));
        const roll = Math.max(-1, Math.min(1, event.gamma / 90));
        onTilt(pitch, roll);
      }
    });
  } catch (e) {
    console.error('Failed to start motion detection:', e);
  }
}

export function stopMotionDetection() {
  isRunning = false;
  Motion.removeAllListeners();
}

export interface MotionConfig {
  targetPitch: keyof SynthParams | null;
  depthPitch: number;
  targetRoll: keyof SynthParams | null;
  depthRoll: number;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  targetPitch: null,
  depthPitch: 0.5,
  targetRoll: null,
  depthRoll: 0.5
};

export function applyMotion(
  base: SynthParams,
  config: MotionConfig,
  pitch: number,
  roll: number
): SynthParams {
  let out: SynthParams | null = null;
  
  const applyMod = (target: keyof SynthParams | null, depth: number, value: number) => {
    if (!target || depth === 0) return;
    const spec = PARAM_SPECS[target];
    if (!spec) return;

    if (!out) out = { ...base };
    
    const range = spec.max - spec.min;
    const half = range / 2;
    const offset = value * depth * half;
    const modded = (out[target] as number) + offset;
    
    const snapped = Math.round((modded - spec.min) / spec.step) * spec.step + spec.min;
    out[target] = Math.max(spec.min, Math.min(spec.max, snapped)) as never;
  };

  applyMod(config.targetPitch, config.depthPitch, pitch);
  applyMod(config.targetRoll, config.depthRoll, roll);

  return out || base;
}
