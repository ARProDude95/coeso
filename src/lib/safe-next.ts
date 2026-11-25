/**
 * Only ever redirect back to a local, single-segment-relative path, so an
 * attacker-supplied `?next=` cannot bounce users off-site after login.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/offers";
  if (!value.startsWith("/") || value.startsWith("//")) return "/offers";
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return "/offers";
  }
  return value;
}
