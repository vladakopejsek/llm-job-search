/**
 * Cheap text checks for "worth a look" before any model reads a posting: the
 * candidate's stack, and a place within reach from home. Board discovery
 * watches a company on them, and the push after each collect is built on them.
 */
import { namesHome, screenLocation, textNamesHome } from "../screen/rules.ts";

const STACK = /\b(typescript|react|next\.?js|node\.?js|nestjs)\b/i;
const EUROPE = /\b(europe|european union|emea|eu|eea|cet|worldwide|anywhere in the world)\b/i;

export function namesStack(title: string, text: string): boolean {
  return STACK.test(title) || STACK.test(text);
}

export function withinReach(location: string | null, text: string): boolean {
  const where = location ?? "";
  // A location the screen rules out on its own ("Latin America - Remote", an office in Berlin) decides it,
  // even when the text mentions Europe somewhere ("our teams across Europe and the Americas").
  if (where && !screenLocation(where, null).pass) return false;
  return EUROPE.test(where) || namesHome(where) || EUROPE.test(text) || textNamesHome(text);
}
