"use client";

import { useTranslations, useLocale } from "next-intl";
import { ShipXWordmark } from "@/components/brand/ship-x-logo";

export interface PrintableStatementEvent {
  id: string;
  type: string;
  date: string;
  amount: number;
  direction: "IN" | "OUT";
  safe?: { id: string; name: string } | null;
  note?: string | null;
  /** Current (point-in-time) remaining balance on the specific record this
   * event belongs to — a drawing's own unapplied amount, a deferred
   * record's own remaining balance, a courier advance's own unpaid amount.
   * Undefined for event types with no such concept (plain transactions,
   * settlements). */
  remaining?: number;
  settled?: boolean;
}

/**
 * Shared print-ready كشف حساب / report layout (Phase 34d/34e) — a single
 * implementation of the letterhead + table structure reused by the party
 * statement tab, the courier statement tab, and the Reports page's PDF
 * export, so "export to PDF" is built once, not three times. Exporting to
 * PDF is just the browser's native print-to-PDF: this component renders
 * normally (hidden) in the page, and the caller's "تصدير PDF" button calls
 * `window.print()` — the dashboard layout already hides the
 * sidebar/header/nav via `print:hidden` (see the (dashboard) layout), and
 * this component itself is only shown via `print:block` (hidden otherwise)
 * so the printed page shows ONLY the statement, nothing else.
 */
export interface PrintableExtraSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export function PrintableStatement({
  title,
  subtitle,
  periodLabel,
  eventTypeLabel,
  events = [],
  totalsBySection,
  /** Omit the الخزنة/safe column entirely — used for per-client/per-courier
   * statements, where exposing which internal safe money moved through is
   * considered sensitive. Defaults to true (today's existing behavior) for
   * any caller that doesn't pass it. */
  showSafe = true,
  /** Additional aggregated breakdown tables (e.g. حسب البند/حسب الجهة on
   * the Reports page) rendered as their own tables after the main events
   * table — lets a page whose data is aggregates-only (not a flat
   * transaction log) still reuse this one shared print layout instead of a
   * second component. */
  extraSections,
}: {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  eventTypeLabel: (type: string) => string;
  events?: PrintableStatementEvent[];
  /** Rendered as a set of summary lines above the table — kept as
   * separate labeled totals (never pre-netted) per this app's hard rule
   * that different event types must never be combined into one figure. */
  totalsBySection: { label: string; amount: number }[];
  showSafe?: boolean;
  extraSections?: PrintableExtraSection[];
}) {
  const t = useTranslations("statement");
  const locale = useLocale();
  const hasRemainingColumn = events.some((e) => e.remaining !== undefined);

  return (
    <div className="hidden print:block print:bg-white print:text-black">
      <div className="flex items-center justify-between border-b border-black/20 pb-4">
        <ShipXWordmark className="text-lg" tone="dark" />
        <div className="text-end text-xs text-black/60">
          <p>{t("generatedAt", { date: new Date().toLocaleString(locale) })}</p>
        </div>
      </div>

      <div className="mt-4">
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-black/70">{subtitle}</p>}
        {periodLabel && <p className="text-sm text-black/70">{periodLabel}</p>}
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        {totalsBySection.map((s) => (
          <div key={s.label} className="print-avoid-break rounded-lg border border-black/20 px-4 py-2">
            <p className="text-xs text-black/60">{s.label}</p>
            <p className="text-base font-semibold">{s.amount.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {events.length > 0 && (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/30 text-start">
              <th className="py-2 text-start">{t("date")}</th>
              <th className="py-2 text-start">{t("type")}</th>
              {showSafe && <th className="py-2 text-start">{t("safe")}</th>}
              <th className="py-2 text-start">{t("note")}</th>
              <th className="py-2 text-end">{t("direction")}</th>
              <th className="py-2 text-end">{t("amount")}</th>
              {hasRemainingColumn && (
                <>
                  <th className="py-2 text-end">{t("remaining")}</th>
                  <th className="py-2 text-end">{t("status")}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="print-avoid-break border-b border-black/10">
                <td className="py-1.5">{new Date(e.date).toLocaleDateString(locale)}</td>
                <td className="py-1.5">{eventTypeLabel(e.type)}</td>
                {showSafe && <td className="py-1.5">{e.safe?.name ?? "—"}</td>}
                <td className="py-1.5">{e.note ?? "—"}</td>
                <td className="py-1.5 text-end">{e.direction === "IN" ? t("in") : t("out")}</td>
                <td className="py-1.5 text-end">{e.amount.toLocaleString()}</td>
                {hasRemainingColumn && (
                  <>
                    <td className="py-1.5 text-end">{e.remaining !== undefined ? e.remaining.toLocaleString() : "—"}</td>
                    <td className="py-1.5 text-end">
                      {e.settled === undefined ? "—" : e.settled ? t("settled") : t("unsettled")}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {events.length === 0 && !extraSections && <p className="mt-4 text-center text-black/60">{t("noEvents")}</p>}

      {extraSections?.map((section) => (
        <div key={section.title} className="print-avoid-break mt-6">
          <h2 className="text-base font-semibold">{section.title}</h2>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/30 text-start">
                {section.columns.map((c) => (
                  <th key={c} className="py-2 text-start">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, i) => (
                <tr key={i} className="print-avoid-break border-b border-black/10">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1.5">
                      {typeof cell === "number" ? cell.toLocaleString() : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
