"use client";

import {
  Combobox,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
} from "@/components/ui/combobox";
import type { Courier } from "@/lib/api-client";

// Shared sentinel for "no specific courier" (historical/unassigned sheet
// collections) — same literal value every caller that supports this option
// already used locally, now centralized here.
export const UNASSIGNED_COURIER = "__unassigned__";

interface ComboboxCourier {
  id: string;
  name: string;
}

/**
 * Live-filtered courier search field (خانة بحث) — replaces the plain
 * Select dropdown everywhere a courier is chosen, so a long courier list
 * doesn't require scrolling to find one by name (mirrors PartyCombobox).
 */
export function CourierCombobox({
  couriers,
  value,
  onChange,
  placeholder,
  allowUnassigned,
  unassignedLabel,
}: {
  couriers: Courier[] | undefined;
  value: string;
  onChange: (courierId: string) => void;
  placeholder?: string;
  /** Adds an "unassigned/historical" option at the top of the list. */
  allowUnassigned?: boolean;
  unassignedLabel?: string;
}) {
  const items: ComboboxCourier[] = [
    ...(allowUnassigned && unassignedLabel ? [{ id: UNASSIGNED_COURIER, name: unassignedLabel }] : []),
    ...(couriers ?? []),
  ];
  const selected = items.find((c) => c.id === value) ?? null;

  return (
    <Combobox
      items={items}
      value={selected}
      onValueChange={(courier) => onChange(courier?.id ?? "")}
      itemToStringLabel={(courier: ComboboxCourier) => courier.name}
      isItemEqualToValue={(a: ComboboxCourier, b: ComboboxCourier) => a.id === b.id}
    >
      <ComboboxInputGroup>
        <ComboboxInput placeholder={placeholder} />
        <ComboboxTrigger />
      </ComboboxInputGroup>
      <ComboboxContent>
        {(courier: ComboboxCourier) => (
          <ComboboxItem key={courier.id} value={courier}>
            {courier.name}
          </ComboboxItem>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
