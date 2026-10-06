"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "cn"
import { ChevronDownIcon, CheckIcon, SearchIcon } from "lucide-react"

const Combobox = ComboboxPrimitive.Root

function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        "flex w-full items-center gap-1.5 rounded-lg border border-input bg-transparent ps-3 pe-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
        className
      )}
      {...props}
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      {props.children}
    </ComboboxPrimitive.InputGroup>
  )
}

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "h-10 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function ComboboxTrigger({ className, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="pointer-events-none size-4" />
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  ...props
}: Omit<ComboboxPrimitive.Popup.Props, "children"> &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset"> & {
    children?: React.ReactNode | ((item: any, index: number) => React.ReactNode)
  }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto scrollbar-hide rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          <ComboboxPrimitive.Empty className="px-3 py-6 text-center text-sm text-muted-foreground empty:m-0 empty:p-0" />
          <ComboboxPrimitive.List>{children}</ComboboxPrimitive.List>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pe-8 ps-2 text-base outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className
      )}
      {...props}
    >
      <span className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">{children}</span>
      <ComboboxPrimitive.ItemIndicator
        render={<span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center" />}
      >
        <CheckIcon className="pointer-events-none" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

export { Combobox, ComboboxInputGroup, ComboboxInput, ComboboxTrigger, ComboboxContent, ComboboxItem }
