import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function ErrorState({ onRetry, message }: { onRetry?: () => void; message?: string }) {
  const tCommon = useTranslations("common");
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-12 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-background text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <p className="text-sm font-medium">{tCommon("couldntLoad")}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{tCommon("couldntLoadDescription")}</p>
      {message && <p className="max-w-sm text-xs text-destructive/80">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          {tCommon("retry")}
        </Button>
      )}
    </div>
  );
}
