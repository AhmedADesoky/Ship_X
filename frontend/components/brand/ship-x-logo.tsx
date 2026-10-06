import { Lora } from "next/font/google";

/**
 * "Ship X" brand mark — serif "Ship" paired with a larger, italic, red "X"
 * (matches the picked design: distinct typeface/style/color from the word,
 * echoing a two-tone wordmark treatment like "Engli-zee"). `ShipXWordmark`
 * is the single source of truth, used at every size from the tiny topbar
 * label up to the login page, with an optional rounded pill background for
 * contexts (like the sidebar header) that want the mark set off as a chip.
 */
const lora = Lora({ subsets: ["latin"], weight: ["600"], style: ["normal", "italic"] });

const RED = "#c0293c";
const RED_ON_DARK = "#e0495a";

export function ShipXWordmark({
  className,
  tone = "dark",
  pill = false,
}: {
  className?: string;
  tone?: "light" | "dark";
  /** Wrap the mark in a soft rounded chip background (navy sidebar/header use). */
  pill?: boolean;
}) {
  const shipColor = tone === "dark" ? "#101d33" : "#f3f0e8";
  const xColor = tone === "dark" ? RED : RED_ON_DARK;

  const mark = (
    // Brand wordmarks don't mirror in RTL apps — pin ltr so "Ship" then "X"
    // always reads left-to-right, regardless of the page's own direction.
    <span dir="ltr" className={`${lora.className} inline-flex items-baseline`}>
      <span style={{ color: shipColor }}>Ship</span>
      <span className="italic" style={{ color: xColor, fontSize: "1.5em", marginInlineStart: "0.05em" }}>
        X
      </span>
    </span>
  );

  if (!pill) {
    return <span className={className}>{mark}</span>;
  }

  const pillBg = tone === "dark" ? "#fbfaf7" : "#1b2740";
  return (
    <span
      className={`inline-flex items-center rounded-full shadow-sm ${className ?? ""}`}
      style={{ background: pillBg, padding: "0.5em 1.1em" }}
    >
      {mark}
    </span>
  );
}

/** Compact icon-only mark for contexts too small for the wordmark (e.g. a favicon-style badge). */
export function ShipXMark({ className, tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const color = tone === "light" ? "#101d33" : RED_ON_DARK;
  return (
    <span className={`${lora.className} italic ${className ?? ""}`} style={{ color, lineHeight: 1 }}>
      X
    </span>
  );
}
