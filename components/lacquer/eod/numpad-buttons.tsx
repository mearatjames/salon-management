// NumpadButtons — pure 3×4 grid for the End-of-Day cash count input.
//
// Layout matches the prototype `design-system/prototypes/transaction/
// EndOfDay.jsx`:
//   [1][2][3]
//   [4][5][6]
//   [7][8][9]
//   [.][0][back]
//
// Stateless: the parent island (`cash-count.client.tsx`) owns the buffer
// and the reducer; this component just dispatches `onPress(key)`. The
// `.` and back buttons get the `.fn` modifier per the prototype so the
// fill colour and font-size match. Backspace uses the Lucide `Delete`
// icon — no emoji in chrome (Constitution Principle I).

import { Delete } from "lucide-react";

export type NumpadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back";

export type NumpadButtonsProps = {
  onPress: (key: NumpadKey) => void;
  disabled?: boolean;
};

const DIGIT_ROWS: NumpadKey[][] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
];

export function NumpadButtons({ onPress, disabled = false }: NumpadButtonsProps) {
  return (
    <div className="eod-numpad" data-slot="eod-numpad">
      {DIGIT_ROWS.flat().map((digit) => (
        <button
          key={digit}
          type="button"
          className="eod-nk"
          data-slot="eod-key"
          data-key={digit}
          disabled={disabled}
          onClick={() => onPress(digit)}
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        className="eod-nk fn"
        data-slot="eod-key"
        data-key="."
        disabled={disabled}
        onClick={() => onPress(".")}
      >
        .
      </button>
      <button
        type="button"
        className="eod-nk"
        data-slot="eod-key"
        data-key="0"
        disabled={disabled}
        onClick={() => onPress("0")}
      >
        0
      </button>
      <button
        type="button"
        className="eod-nk fn"
        data-slot="eod-key"
        data-key="back"
        aria-label="Backspace"
        disabled={disabled}
        onClick={() => onPress("back")}
      >
        <Delete size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
