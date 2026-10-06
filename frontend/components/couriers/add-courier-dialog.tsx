"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, type Courier } from "@/lib/api-client";
import { useSession } from "@/lib/session";

export function AddCourierDialog({
  open,
  onOpenChange,
  courier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing courier instead of creating one. */
  courier?: Courier;
}) {
  const t = useTranslations("couriers");
  const tCommon = useTranslations("common");
  const { accessToken } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setName(courier?.name ?? "");
      setPhone(courier?.phone ?? "");
      setNotes(courier?.notes ?? "");
    }
  }, [open, courier]);

  const mutation = useMutation({
    mutationFn: () => {
      const dto = { name, phone: phone || undefined, notes: notes || undefined };
      return courier
        ? api.couriers.update(courier.id, dto, accessToken ?? undefined)
        : api.couriers.create(dto, accessToken ?? undefined);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["couriers"] });
      if (!("id" in result) && (result as any)?.queued) {
        toast.info(tCommon("queuedForApproval"));
      } else {
        toast.success(tCommon("success"));
      }
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : tCommon("error")),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass">
        <DialogHeader>
          <DialogTitle>{courier ? t("editCourier") : t("addCourier")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="courier-name">{t("name")}</Label>
            <Input id="courier-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="courier-phone">{t("phone")}</Label>
            <Input id="courier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="courier-notes">{t("notes")}</Label>
            <Textarea id="courier-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending || !name}>
              {courier ? tCommon("save") : t("addCourier")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
