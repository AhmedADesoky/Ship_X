"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { guessRouteLabel } from "./route-label";

export interface FlowTrailStep {
  label: string;
  href: string;
}

interface FlowTrailContextValue {
  trail: FlowTrailStep[];
  /** Sidebar links call this on click — starts a fresh trail at exactly
   * this one step, discarding whatever came before. */
  resetTrail: (label: string, href: string) => void;
  /** Detail pages call this once their entity's real name has loaded, to
   * replace the current (last) step's generic placeholder label — does
   * not add a new step. */
  setCurrentLabel: (label: string) => void;
}

const FlowTrailContext = createContext<FlowTrailContextValue | null>(null);

const MAX_TRAIL_LENGTH = 8;

export function FlowTrailProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tApp = useTranslations("app");
  const [trail, setTrail] = useState<FlowTrailStep[]>(() => [
    { label: guessRouteLabel(pathname, tNav, tApp), href: pathname },
  ]);
  // Avoids re-running the passive pathname effect for the very first
  // render (already seeded above) and for a pathname change that was
  // just caused by resetTrail() itself (already set to the right value).
  const lastHandledPathname = useRef(pathname);

  useEffect(() => {
    if (pathname === lastHandledPathname.current) return;
    lastHandledPathname.current = pathname;

    setTrail((prev) => {
      const existingIndex = prev.findIndex((step) => step.href === pathname);
      if (existingIndex !== -1) return prev.slice(0, existingIndex + 1);
      const next = [...prev, { label: guessRouteLabel(pathname, tNav, tApp), href: pathname }];
      return next.length > MAX_TRAIL_LENGTH ? next.slice(next.length - MAX_TRAIL_LENGTH) : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const value = useMemo<FlowTrailContextValue>(
    () => ({
      trail,
      resetTrail: (label, href) => {
        lastHandledPathname.current = href;
        setTrail([{ label, href }]);
      },
      setCurrentLabel: (label) => {
        setTrail((prev) => {
          if (prev.length === 0) return prev;
          const next = [...prev];
          next[next.length - 1] = { ...next[next.length - 1], label };
          return next;
        });
      },
    }),
    [trail],
  );

  return <FlowTrailContext.Provider value={value}>{children}</FlowTrailContext.Provider>;
}

export function useFlowTrail() {
  const ctx = useContext(FlowTrailContext);
  if (!ctx) throw new Error("useFlowTrail must be used within FlowTrailProvider");
  return ctx;
}
