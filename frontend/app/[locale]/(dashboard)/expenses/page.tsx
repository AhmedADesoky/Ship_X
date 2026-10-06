"use client";

import { CategoryKindPage } from "@/components/categories/category-kind-page";
import { RequirePermission } from "@/components/layout/require-permission";
import { TrendingDown } from "lucide-react";

export default function ExpensesPage() {
  return (
    <RequirePermission>
      <CategoryKindPage kind="OUT" namespace="expenses" icon={TrendingDown} />
    </RequirePermission>
  );
}
