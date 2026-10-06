"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Plus, X } from "lucide-react";

/** Translates the two canonical party types; any custom type is shown as-is
 * (it's whatever the user typed when adding it). */
export function partyTypeLabel(type: string, t: (key: string) => string) {
  if (type === "AGENT") return t("agents");
  if (type === "MERCHANT") return t("merchants");
  return type;
}

/**
 * Shared type picker for Parties and Clients: a Select of known types (from
 * usePartyTypes) plus a "+" button that reveals an inline input to add a
 * new custom type, auto-selected once confirmed. Mirrors the safe-type
 * picker on the Safes page.
 */
const NONE_VALUE = "__none__";

export function PartyTypePicker({
  value,
  onChange,
  types,
  addType,
  allowNone,
  noneLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  types: string[];
  addType: (value: string) => void;
  /** Shows a leading "none" option that reports back as "" (unset). */
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const t = useTranslations("parties");
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");

  function confirmNewType() {
    const value = newType.trim().toUpperCase();
    if (!value) return;
    addType(value);
    onChange(value);
    setNewType("");
    setAdding(false);
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          autoFocus
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          placeholder={t("newTypePlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirmNewType();
            } else if (e.key === "Escape") {
              setAdding(false);
              setNewType("");
            }
          }}
        />
        <Button type="button" size="icon" onClick={confirmNewType} disabled={!newType.trim()}>
          <Check className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setAdding(false);
            setNewType("");
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Select
        value={value === "" ? NONE_VALUE : value}
        onValueChange={(v) => onChange(v === NONE_VALUE ? "" : (v ?? "AGENT"))}
      >
        <SelectTrigger className="w-full">
          <SelectValue>{value === "" ? noneLabel : partyTypeLabel(value, t)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE_VALUE}>{noneLabel}</SelectItem>}
          {types.map((type) => (
            <SelectItem key={type} value={type}>
              {partyTypeLabel(type, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="outline" size="icon" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
