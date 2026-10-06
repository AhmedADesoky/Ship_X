"use client";

import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useFlowTrail } from "@/lib/flow-trail";

/**
 * Horizontal, clickable navigation trail showing the actual sequence of
 * pages visited this session (not a fixed site hierarchy) — see
 * lib/flow-trail.tsx for how steps are built. Every step but the last is a
 * link; clicking one jumps straight there and truncates the trail to that
 * point. Hidden entirely when there's nothing to show yet (just the
 * current page, e.g. right after a reload or a sidebar click).
 */
export function FlowTrailBar() {
  const { trail } = useFlowTrail();

  if (trail.length <= 1) return null;

  return (
    <nav
      aria-label="breadcrumb"
      className="glass mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto rounded-full px-3 py-2 text-sm shadow-sm scrollbar-hide"
    >
      {trail.map((step, i) => {
        const isLast = i === trail.length - 1;
        return (
          <div key={`${step.href}-${i}`} className="flex shrink-0 items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 rtl:rotate-180" />}
            {isLast ? (
              <span className="truncate rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground shadow-sm">
                {step.label}
              </span>
            ) : (
              <Link
                href={step.href}
                className="truncate rounded-full px-3 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {step.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
