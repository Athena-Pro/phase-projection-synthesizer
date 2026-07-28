import React from 'react';

export interface PatchEntry {
  /** Index into the app's combined patch list (factory patches then user slots). */
  index: number;
  label: string;
  /** True for a user slot with nothing stored in it. */
  empty?: boolean;
}

interface PatchStripProps {
  banks: string[];
  bank: string;
  onBankChange: (bank: string) => void;
  /** Patches in the currently selected bank, in display order. */
  entries: PatchEntry[];
  patchIndex: number;
  onSelect: (index: number) => void;
  onStep: (delta: number) => void;
  patchName: string;
  patchNumber: number;
  edited: boolean;
  statusLine: string;
  /** User-slot controls, shown only while the User bank is selected. */
  isUserBank: boolean;
  slotOccupied: boolean;
  slotName: string;
  onSlotNameChange: (name: string) => void;
  onStore: () => void;
  onClear: () => void;
  storeHint: string;
}

const selectClass =
  'phosphor-select bg-transparent border border-phos-dim rounded-sm vfd-text ' +
  'text-[9px] tracking-[0.1em] uppercase px-1 py-0.5 cursor-pointer outline-none ' +
  'focus:border-phos hover:bg-phos/10 max-w-[150px] truncate';

const buttonClass =
  'h-6 px-1.5 border border-phos-dim rounded-sm vfd-text text-[9px] tracking-[0.1em] ' +
  'uppercase cursor-pointer hover:bg-phos/10 whitespace-nowrap';

/**
 * The VFD strip: what patch is loaded, which bank it came from, and — in the User bank —
 * the controls for storing the current sound into memory.
 *
 * Stepping with ◂ ▸ stays *inside* the selected bank and wraps there, which is the whole
 * point of banks; the selectors are for jumping between them.
 */
export default function PatchStrip({
  banks,
  bank,
  onBankChange,
  entries,
  patchIndex,
  onSelect,
  onStep,
  patchName,
  patchNumber,
  edited,
  statusLine,
  isUserBank,
  slotOccupied,
  slotName,
  onSlotNameChange,
  onStore,
  onClear,
  storeHint,
}: PatchStripProps) {
  return (
    <div className="phosphor border border-silk/25 rounded-sm px-3 py-1.5 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="vfd-text text-[11px] tracking-[0.12em] uppercase truncate">
            Patch {String(patchNumber).padStart(2, '0')}: {patchName}
            {edited ? ' *' : ''}
          </span>
          <span className="vfd-text text-[9px] tracking-[0.12em] uppercase opacity-75 truncate">
            {statusLine}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <select
            value={bank}
            onChange={(e) => onBankChange(e.target.value)}
            className={selectClass}
            title="Patch bank"
            aria-label="Patch bank"
          >
            {banks.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            value={patchIndex}
            onChange={(e) => onSelect(Number(e.target.value))}
            className={selectClass}
            title="Patch"
            aria-label="Patch"
          >
            {entries.map((entry) => (
              <option key={entry.index} value={entry.index}>
                {entry.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => onStep(-1)}
            className="w-6 h-6 border border-phos-dim rounded-sm vfd-text text-[10px] cursor-pointer hover:bg-phos/10"
            title="Previous patch in this bank"
          >
            ◂
          </button>
          <button
            onClick={() => onStep(1)}
            className="w-6 h-6 border border-phos-dim rounded-sm vfd-text text-[10px] cursor-pointer hover:bg-phos/10"
            title="Next patch in this bank"
          >
            ▸
          </button>
          <button onClick={onStore} className={buttonClass} title={storeHint}>
            Store
          </button>
        </div>
      </div>

      {isUserBank && (
        <div className="flex items-center gap-1.5 flex-wrap border-t border-phos-dim/40 pt-1">
          <span className="vfd-text text-[8px] tracking-[0.18em] uppercase opacity-70">
            Memory
          </span>
          <input
            value={slotName}
            onChange={(e) => onSlotNameChange(e.target.value)}
            disabled={!slotOccupied}
            maxLength={40}
            placeholder={slotOccupied ? 'slot name' : 'empty — press Store'}
            title={
              slotOccupied
                ? 'Rename this memory slot'
                : 'This slot is empty. Dial in a sound and press Store to write it here.'
            }
            className="flex-1 min-w-[110px] bg-transparent border border-phos-dim rounded-sm vfd-text text-[9px] tracking-[0.1em] px-1.5 py-0.5 outline-none focus:border-phos disabled:opacity-40"
          />
          <button
            onClick={onClear}
            disabled={!slotOccupied}
            className={`${buttonClass} disabled:opacity-40 disabled:cursor-default`}
            title="Erase this memory slot"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
