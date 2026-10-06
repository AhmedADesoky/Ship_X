"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { PartyList } from "@/components/parties/party-list";

export default function SendersPage() {
  const t = useTranslations("parties");

  return (
    <RequirePermission>
      <div className="flex flex-col gap-6">
        <PageHeader title={t("merchants")} description={t("subtitle")} />
        <PartyList partyType="MERCHANT" />
      </div>
    </RequirePermission>
  );
}
