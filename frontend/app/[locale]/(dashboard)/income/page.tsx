"use client";

import { CategoryKindPage } from "@/components/categories/category-kind-page";
import { RequirePermission } from "@/components/layout/require-permission";
import { TrendingUp } from "lucide-react";

export default function IncomePage() {
  return (
    <RequirePermission>
      <CategoryKindPage kind="IN" namespace="income" icon={TrendingUp} />
    </RequirePermission>
  );
}
