import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Class names joined, with later Tailwind classes winning over earlier ones (`cn("p-2", "p-4")` is "p-4"). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
