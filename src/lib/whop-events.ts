/**
 * Whop webhook payload parsing — pure, so the handler and its tests agree on
 * exactly which fields mean what. The SDK verifies the signature; this module
 * only reads the (untyped) event object afterwards.
 */

export type WhopEventKind =
  | "payment_succeeded"
  | "payment_failed"
  | "membership_activated"
  | "membership_deactivated"
  | "cancel_at_period_end"
  | "ignored";

export interface WhopEvent {
  id?: unknown;
  type?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

/** Current Whop event names (PROGRESS #23 documents the mapping). */
export function classifyWhopEvent(type: string, data: WhopData): WhopEventKind {
  switch (type) {
    case "payment.succeeded":
      return "payment_succeeded";
    case "payment.failed":
      return "payment_failed";
    case "membership.activated":
      return "membership_activated";
    case "membership.deactivated":
    case "membership.canceled":
      return "membership_deactivated";
    case "membership.cancel_at_period_end_changed":
      return "cancel_at_period_end";
    case "membership.updated":
      // `membership.updated` is the generic carrier; the status decides.
      if (data.status === "canceled" || data.status === "expired") {
        return "membership_deactivated";
      }
      return data.status === "active"
        ? "membership_activated"
        : "ignored";
    default:
      return "ignored";
  }
}

export type WhopData = Record<string, unknown>;

function asRecord(value: unknown): WhopData | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as WhopData)
    : null;
}

export function eventData(event: WhopEvent): WhopData {
  return asRecord(event.data) ?? {};
}

export function eventType(event: WhopEvent): string {
  return typeof event.type === "string" ? event.type : "";
}

/** Payload id first, Standard Webhooks header id as the fallback. */
export function eventId(event: WhopEvent, headerId: string | null): string | null {
  if (typeof event.id === "string" && event.id.trim()) return event.id.trim();
  return headerId?.trim() || null;
}

/** Metadata we put on the checkout; copied by Whop to payments/memberships. */
export function eventMetadata(event: WhopEvent): WhopData {
  const data = eventData(event);
  return (
    asRecord(data.metadata) ??
    asRecord(asRecord(data.membership)?.metadata) ??
    {}
  );
}

export function metadataString(event: WhopEvent, key: string): string | null {
  const value = eventMetadata(event)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Our user id, passed as `metadata.user_id` at checkout. */
export function appUserId(event: WhopEvent): string | null {
  return metadataString(event, "user_id") ?? metadataString(event, "app_user_id");
}

function firstString(data: WhopData, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

export function whopPlanIdOf(event: WhopEvent): string | null {
  const data = eventData(event);
  const direct = firstString(data, ["plan_id", "planId"]);
  if (direct) return direct;
  const plan = asRecord(data.plan);
  if (plan) {
    const nested = firstString(plan, ["id", "plan_id"]);
    if (nested) return nested;
  }
  const membership = asRecord(data.membership);
  return membership
    ? firstString(membership, ["plan_id", "planId"])
    : null;
}

/**
 * Membership id on activation/deactivation, or on a payment's payload. The
 * `data.id` fallback is only valid for membership events — on a payment it is
 * the *payment* id and must never be stored as a membership id.
 */
export function membershipIdOf(
  event: WhopEvent,
  kind?: WhopEventKind,
): string | null {
  const data = eventData(event);
  const direct = firstString(data, ["membership_id", "membershipId"]);
  if (direct) return direct;

  const membership = data.membership;
  if (typeof membership === "string" && membership.trim()) {
    return membership.trim();
  }
  if (membership) {
    const nested = firstString(asRecord(membership) ?? {}, ["id"]);
    if (nested) return nested;
  }

  // Membership events carry the membership itself as `data`; payment events
  // must not fall back to it.
  const isMembershipEvent =
    kind === "membership_activated" ||
    kind === "membership_deactivated" ||
    kind === "cancel_at_period_end";
  return isMembershipEvent ? firstString(data, ["id"]) : null;
}

function toIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Whop timestamps are unix seconds.
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/** End of the paid period — drives `currentPeriodEnd`. */
export function periodEndOf(event: WhopEvent): string | null {
  const data = eventData(event);
  for (const key of [
    "renewal_period_end",
    "current_period_end",
    "period_end",
    "expires_at",
  ]) {
    const iso = toIso(data[key]);
    if (iso) return iso;
  }
  const membership = asRecord(data.membership);
  if (membership) {
    for (const key of ["renewal_period_end", "current_period_end", "expires_at"]) {
      const iso = toIso(membership[key]);
      if (iso) return iso;
    }
  }
  return null;
}

/** Scheduled cancellation flag on the membership payload. */
export function cancelAtPeriodEndOf(event: WhopEvent): boolean {
  const value = eventData(event).cancel_at_period_end;
  return value === true || value === 1 || value === "true";
}

/** Short human-readable detail for an admin flag. */
export function paymentSummary(event: WhopEvent): string {
  const data = eventData(event);
  const amount =
    typeof data.amount === "number"
      ? data.amount
      : typeof data.total === "number"
        ? data.total
        : null;
  const currency =
    typeof data.currency === "string" ? data.currency.toUpperCase() : null;
  const paymentId = firstString(data, ["id", "payment_id"]);
  return [
    paymentId ? `payment ${paymentId}` : null,
    amount !== null && currency ? `${currency} ${amount}` : null,
    whopPlanIdOf(event) ? `plan ${whopPlanIdOf(event)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
