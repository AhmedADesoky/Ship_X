"use client";

import { useTranslations } from "next-intl";
import {
  Combobox,
  ComboboxInputGroup,
  ComboboxInput,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxItem,
} from "@/components/ui/combobox";
import type { Party } from "@/lib/api-client";

/**
 * Live-filtered party search field (خانة بحث) — replaces the plain Select
 * dropdown everywhere a party (agent/merchant) is chosen, so long party
 * lists don't require scrolling to find one by name.
 */
export function PartyCombobox({
  parties,
  value,
  onChange,
  placeholder,
}: {
  parties: Party[] | undefined;
  value: string;
  onChange: (partyId: string) => void;
  placeholder?: string;
}) {
  const tCommon = useTranslations("common");
  const selected = parties?.find((p) => p.id === value) ?? null;

  return (
    <Combobox
      items={parties ?? []}
      value={selected}
      onValueChange={(party) => onChange(party?.id ?? "")}
      itemToStringLabel={(party: Party) => party.name}
      isItemEqualToValue={(a: Party, b: Party) => a.id === b.id}
    >
      <ComboboxInputGroup>
        <ComboboxInput placeholder={placeholder} />
        <ComboboxTrigger />
      </ComboboxInputGroup>
      <ComboboxContent>
        {(party: Party) => (
          <ComboboxItem key={party.id} value={party}>
            {party.name}
          </ComboboxItem>
        )}
      </ComboboxContent>
    </Combobox>
  );
}
