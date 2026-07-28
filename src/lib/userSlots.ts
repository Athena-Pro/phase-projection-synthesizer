import { SynthParams } from '../types';

/**
 * User memory slots — the player's own patches, persisted in localStorage.
 *
 * The important property here is forward compatibility. `SynthParams` has grown several
 * times (the arithmetic oscillator, its number sequence, the unison expander) and will grow
 * again, so a patch saved by an older build is missing keys a newer build expects. Every
 * load therefore goes through `normalizeParams`, which rebuilds the record key-by-key from
 * the neutral patch and only accepts finite numbers — a stored patch can never introduce a
 * missing field, a NaN, or a stray key, whatever wrote it.
 *
 * Storage is best-effort: a browser with localStorage disabled or full keeps working, it
 * just does not persist.
 */

export const USER_SLOT_COUNT = 16;
export const USER_BANK = 'User';

const STORAGE_KEY = 'pps.user-slots.v1';

export interface UserSlot {
  name: string;
  params: SynthParams;
  savedAt: number;
}

/**
 * Rebuild a parameter record from untrusted data: every key of the neutral patch, taken
 * from `raw` when it is a finite number and from the base otherwise. Unknown keys are
 * dropped rather than carried along.
 */
export function normalizeParams(raw: unknown, base: SynthParams): SynthParams {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as SynthParams;
  for (const key of Object.keys(base) as (keyof SynthParams)[]) {
    const v = src[key as string];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : base[key];
  }
  return out;
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return null;
  }
}

/** Load all slots, padded and normalized to exactly USER_SLOT_COUNT entries. */
export function loadUserSlots(base: SynthParams): (UserSlot | null)[] {
  const slots: (UserSlot | null)[] = new Array(USER_SLOT_COUNT).fill(null);
  const text = readStorage();
  if (!text) return slots;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    return slots;
  }
  if (!Array.isArray(parsed)) return slots;
  for (let i = 0; i < Math.min(USER_SLOT_COUNT, parsed.length); i++) {
    const entry = parsed[i] as Record<string, unknown> | null;
    if (!entry || typeof entry !== 'object' || !entry.params) continue;
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : `Slot ${i + 1}`;
    const savedAt = typeof entry.savedAt === 'number' && Number.isFinite(entry.savedAt) ? entry.savedAt : 0;
    slots[i] = { name: name.slice(0, 40), params: normalizeParams(entry.params, base), savedAt };
  }
  return slots;
}

/** Persist all slots. Returns false when storage is unavailable or rejected the write. */
export function saveUserSlots(slots: (UserSlot | null)[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
    return true;
  } catch (_) {
    return false;
  }
}

/** Index of the first free slot, or −1 when every slot is occupied. */
export function firstEmptySlot(slots: (UserSlot | null)[]): number {
  return slots.findIndex((s) => s === null);
}

/** A default name for a patch stored from `source`, kept unique-ish and short. */
export function slotNameFor(source: string, slotIndex: number): string {
  const trimmed = source.replace(/\s*\*$/, '').trim();
  return (trimmed ? `${trimmed} ✎` : `Slot ${slotIndex + 1}`).slice(0, 40);
}
