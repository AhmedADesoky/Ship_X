"use client"

import * as React from "react"
import { Input } from "./input"

function formatWithCommas(raw: string): string {
  if (!raw) return ""
  const [intPart, decPart] = raw.split(".")
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt
}

// Digits and at most one decimal point — everything else (commas, letters,
// a second dot) is stripped so the underlying value stays a plain numeric
// string regardless of what the user typed or pasted.
function stripToRaw(display: string): string {
  const digitsAndDot = display.replace(/[^\d.]/g, "")
  const firstDot = digitsAndDot.indexOf(".")
  if (firstDot === -1) return digitsAndDot
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, "")
}

export interface AmountInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "inputMode"> {
  value: string
  onChange: (value: string) => void
}

/**
 * A money-amount input that displays thousand separators as you type
 * (1000000 -> 1,000,000) while the value passed to onChange — and the form
 * state it drives — stays a plain numeric string, so Number(value) at
 * submit time works exactly like it did on a raw type="number" input.
 * Must be type="text" (browsers reject commas in type="number"), so the
 * cursor position has to be restored manually after each reformat —
 * otherwise it jumps to the end of the field on every keystroke, which is
 * especially jarring when editing a digit in the middle of a long number.
 */
function AmountInput({ value, onChange, ref, ...props }: AmountInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const innerRef = React.useRef<HTMLInputElement | null>(null)

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node
    },
    [ref],
  )

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target
    const prevDisplay = el.value
    const prevCursor = el.selectionStart ?? prevDisplay.length
    // How many significant (digit/dot) characters sit before the cursor —
    // this count is what we restore the cursor relative to after the
    // value is reformatted, since comma insertion/removal shifts raw
    // character offsets but never changes this count.
    const significantBeforeCursor = prevDisplay.slice(0, prevCursor).replace(/[^\d.]/g, "").length

    const raw = stripToRaw(prevDisplay)
    onChange(raw)

    const nextDisplay = formatWithCommas(raw)
    requestAnimationFrame(() => {
      if (!innerRef.current) return
      let count = 0
      let pos = nextDisplay.length
      for (let i = 0; i < nextDisplay.length; i++) {
        if (/[\d.]/.test(nextDisplay[i])) count++
        if (count === significantBeforeCursor) {
          pos = i + 1
          break
        }
      }
      innerRef.current.setSelectionRange(pos, pos)
    })
  }

  return (
    <Input
      {...props}
      ref={setRefs}
      type="text"
      inputMode="decimal"
      value={formatWithCommas(value)}
      onChange={handleChange}
    />
  )
}

export { AmountInput }
