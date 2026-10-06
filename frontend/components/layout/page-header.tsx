import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Consistent page-header pattern used across every dashboard page: title on
 * the left, an optional primary action button on the right, and an optional
 * back link for detail pages navigated to from a list. The icon rotates
 * under RTL so it keeps pointing toward the start of reading direction.
 */
export function PageHeader({
  title,
  description,
  action,
  backHref,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  backHref?: string;
}) {
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
      <div>
        {backHref && (
          <Link href={backHref}>
            <Button variant="ghost" size="sm" className="mb-2 -ms-2 gap-1.5 text-muted-foreground">
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {tCommon("back")}
            </Button>
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
