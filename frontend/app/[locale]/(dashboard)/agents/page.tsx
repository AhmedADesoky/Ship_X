"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/page-header";
import { RequirePermission } from "@/components/layout/require-permission";
import { PartyList } from "@/components/parties/party-list";

export default function AgentsPage() {
  const t = useTranslations("parties");

  return (
    <RequirePermission>
      <div className="flex flex-col gap-6">
        <PageHeader title={t("agents")} description={t("subtitle")} />
        <PartyList partyType="AGENT" />
      </div>
    </RequirePermission>
  );
}
