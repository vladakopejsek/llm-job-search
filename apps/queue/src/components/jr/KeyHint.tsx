import { Kbd } from "@/components/ui/kbd";

/** The keyboard shortcut for an action, shown on the action itself. Hidden on touch screens, which have no keyboard. */
export function KeyHint({ children }: { children: string }) {
  return <Kbd className="pointer-coarse:hidden">{children}</Kbd>;
}
