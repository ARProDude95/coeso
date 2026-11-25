import { z } from "zod";

/** Trimmed, length-bounded string with a helpful message. */
function text(min: number, max: number, label: string) {
  return z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} character${min === 1 ? "" : "s"}`)
    .max(max, `${label} must be at most ${max} characters`);
}

/* ----------------------------- accounts ---------------------------- */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .max(254, "Email must be at most 254 characters")
  .regex(EMAIL_PATTERN, "Enter a valid email address")
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .max(200, "Password must be at most 200 characters");

/* --------------------------- paid plan ---------------------------- */

/**
 * Access roles are short slugs (`closer-vip`) rather than free text so they
 * are safe to interpolate into UI copy, compare exactly, and later match
 * against Discord role ids/names without a schema change.
 */
export const ROLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/i;
export const ROLE_PATTERN_MESSAGE =
  "Use 2–32 letters, numbers or hyphens (for example closer-vip)";

export const roleSchema = z
  .string({ error: "Role is required" })
  .trim()
  .max(32, "Roles are at most 32 characters")
  .regex(ROLE_PATTERN, ROLE_PATTERN_MESSAGE);

/**
 * Patch semantics: a missing key means "leave it alone", so nothing here has
 * a default. An empty webhook string clears the setting.
 */
const httpsUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(500, "URLs are at most 500 characters")
    .refine(
      (value) => value === "" || value.startsWith("https://"),
      `Enter an https:// ${label}, or leave it empty to clear it`,
    );

export const settingsPatchSchema = z.object({
  plan: z.enum(["free", "paid"]).optional(),
  discordWebhookUrl: httpsUrl("webhook URL").optional(),
  // Buying the plan happens on Whop's hosted page, so this link is all the
  // board needs — and it must be settable on the free plan, obviously.
  whopCheckoutUrl: httpsUrl("checkout URL").optional(),
});

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Admin assigns or removes an access role on a member's account. */
export const memberRoleSchema = z.object({
  role: roleSchema,
  action: z.enum(["add", "remove"]),
});

export type MemberRoleInput = z.infer<typeof memberRoleSchema>;

export const signupSchema = z.object({
  name: text(2, 60, "Name"),
  email: emailSchema,
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  // Not the signup rule: an existing short password must still be able to sign
  // in and get a generic "incorrect email or password" answer.
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required")
    .max(200, "Password must be at most 200 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const roleTypeSchema = z.enum(["setter", "closer", "both"]);
export const offerStatusSchema = z.enum(["open", "paused", "closed"]);

/** Membership tier and the saved-search filter variant ("all" = no filter). */
export const tierSchema = z.enum(["free", "pro", "elite"]);
export const tierFilterSchema = z.enum(["free", "pro", "elite", "all"]);
export const offerTierFilterSchema = z.enum(["setter", "closer", "both", "all"]);

/** Admin assigns or changes a member's tier. */
export const memberTierSchema = z.object({ tier: tierSchema });

export type MemberTierInput = z.infer<typeof memberTierSchema>;
export const applicationStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
]);
export const experienceLevelSchema = z.enum([
  "entry",
  "junior",
  "mid",
  "senior",
  "expert",
]);

/* ---------------------------- offers ---------------------------- */

/**
 * Offer fields with **no defaults**, so the PATCH schema can make every key
 * optional without Zod quietly re-applying a default and overwriting a column
 * the admin never sent.
 */
const offerFields = {
  title: text(3, 120, "Title"),
  company: text(2, 80, "Company"),
  description: text(1, 5000, "Description"),
  roleType: roleTypeSchema,
  commission: text(1, 120, "Commission"),
  payType: text(1, 60, "Pay type"),
  requirements: z
    .string()
    .trim()
    .max(2000, "Requirements must be at most 2000 characters"),
  status: offerStatusSchema,
  expiresAt: z
    .string()
    .trim()
    .nullable()
    .refine(
      (value) => value === null || value === "" || !Number.isNaN(Date.parse(value)),
      "Expiry must be a valid date",
    )
    .transform((value) =>
      value && value !== "" ? new Date(value).toISOString() : null,
    ),
  featured: z.boolean(),
  /**
   * Paid plan only: when set, members without this role never see the offer.
   * `nullable()` with no default here keeps PATCH's "missing key = leave
   * alone" contract intact; the create schema defaults it to null.
   */
  requiredRole: z
    .string({ error: "Role is required" })
    .trim()
    .max(32, "Roles are at most 32 characters")
    .regex(ROLE_PATTERN, ROLE_PATTERN_MESSAGE)
    .nullable(),
  /** Audience tier, used by saved-search filters (everyone may still view). */
  tier: tierSchema,
  /**
   * Numeric commission for the "minimum commission" saved-search filter.
   * Nullable because `commission` above stays free text and most offers have
   * nothing clean to parse out of it.
   */
  commissionAmount: z
    .number()
    .int("Commission amount must be a whole number")
    .min(0, "Commission amount cannot be negative")
    .max(100_000_000, "Commission amount is too large")
    .nullable(),
};

export const offerInputSchema = z.object({
  ...offerFields,
  requirements: offerFields.requirements.default(""),
  status: offerFields.status.default("open"),
  expiresAt: offerFields.expiresAt.default(null),
  featured: offerFields.featured.default(false),
  requiredRole: offerFields.requiredRole.default(null),
  tier: offerFields.tier.default("free"),
  commissionAmount: offerFields.commissionAmount.default(null),
});

export type OfferInput = z.infer<typeof offerInputSchema>;

/** Partial patch: every key optional, and a missing key means "leave alone". */
export const offerPatchSchema = z.object({
  title: offerFields.title.optional(),
  company: offerFields.company.optional(),
  description: offerFields.description.optional(),
  roleType: offerFields.roleType.optional(),
  commission: offerFields.commission.optional(),
  payType: offerFields.payType.optional(),
  requirements: offerFields.requirements.optional(),
  status: offerFields.status.optional(),
  expiresAt: offerFields.expiresAt.optional(),
  featured: offerFields.featured.optional(),
  requiredRole: offerFields.requiredRole.optional(),
  tier: offerFields.tier.optional(),
  commissionAmount: offerFields.commissionAmount.optional(),
});

export type OfferPatch = z.infer<typeof offerPatchSchema>;

/* ------------------------- saved searches ------------------------- */

/**
 * A saved search is a filter set. Missing keys on PATCH mean "leave alone",
 * so nothing here has a default.
 */
const savedSearchFields = {
  name: text(1, 60, "Name"),
  roleType: offerTierFilterSchema,
  tier: tierFilterSchema,
  keywords: z
    .string()
    .trim()
    .max(200, "Keywords must be at most 200 characters"),
  minCommission: z
    .number()
    .int("Minimum commission must be a whole number")
    .min(0, "Minimum commission cannot be negative")
    .max(100_000_000, "Minimum commission is too large")
    .nullable(),
};

export const savedSearchCreateSchema = z.object({
  name: savedSearchFields.name,
  roleType: savedSearchFields.roleType.default("all"),
  tier: savedSearchFields.tier.default("all"),
  keywords: savedSearchFields.keywords.default(""),
  minCommission: savedSearchFields.minCommission.default(null),
});

export type SavedSearchCreateInput = z.infer<typeof savedSearchCreateSchema>;

export const savedSearchPatchSchema = z
  .object({
    name: savedSearchFields.name.optional(),
    roleType: savedSearchFields.roleType.optional(),
    tier: savedSearchFields.tier.optional(),
    keywords: savedSearchFields.keywords.optional(),
    minCommission: savedSearchFields.minCommission.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    { error: "Nothing to update" },
  );

export type SavedSearchPatchInput = z.infer<typeof savedSearchPatchSchema>;

/* ---------------------------- reviews ---------------------------- */

const ratingSchema = z
  .number({ error: "A rating is required" })
  .int("Ratings must be a whole number")
  .min(1, "Ratings run from 1 to 5")
  .max(5, "Ratings run from 1 to 5");

export const reviewInputSchema = z.object({
  payoutRating: ratingSchema,
  leadRating: ratingSchema,
  supportRating: ratingSchema,
  comment: z
    .string()
    .trim()
    .max(1000, "Comments must be at most 1000 characters")
    .default(""),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/* ---------------------------- reports ---------------------------- */

export const reportInputSchema = z.object({
  reason: text(5, 500, "Reason"),
});

export type ReportInput = z.infer<typeof reportInputSchema>;

/** Admin decision on a partner submission. */
export const offerApprovalSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

/** Admin action on a report row (closing the offer uses the offer PATCH). */
export const reportActionSchema = z.object({
  action: z.enum(["dismiss"]),
});

/** Notifications only ever take a read/mark action — no body from clients. */
export const notificationsActionSchema = z
  .object({ id: z.string().uuid().optional() })
  .optional()
  .default({});

/* ---------------------------- billing ----------------------------- */

/** Checkout request: a plan key from the single pricing config. */
export const billingCheckoutSchema = z.object({
  planKey: text(1, 40, "Plan"),
});

/** Admin-only manual tier grant (the billing override). */
export const billingGrantSchema = z.object({
  userId: z.string({ error: "Pick a member" }).uuid("Pick a member"),
  tier: tierSchema,
});

export type BillingGrantInput = z.infer<typeof billingGrantSchema>;

/* --------------------------- rep deals ---------------------------- */

/**
 * A logged result for one offer. Whole dollars: the profile shows a range,
 * not an invoice, so no cents and no currency conversion.
 */
export const dealInputSchema = z
  .object({
    offerId: z.string({ error: "Pick an offer" }).uuid("Pick an offer"),
    dealsClosed: z
      .number({ error: "Deals closed is required" })
      .int("Deals closed must be a whole number")
      .min(1, "Log at least one closed deal")
      .max(100_000, "That number is too large"),
    /** `YYYY-MM`; the API defaults it to the current UTC month. */
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a valid month")
      .optional(),
    earningsMin: z
      .number()
      .int("Earnings must be a whole number")
      .min(0, "Earnings cannot be negative")
      .max(1_000_000_000, "That number is too large")
      .nullable()
      .default(null),
    earningsMax: z
      .number()
      .int("Earnings must be a whole number")
      .min(0, "Earnings cannot be negative")
      .max(1_000_000_000, "That number is too large")
      .nullable()
      .default(null),
  })
  .refine(
    (value) =>
      value.earningsMin === null ||
      value.earningsMax === null ||
      value.earningsMax >= value.earningsMin,
    { error: "The top of the range must be at least the bottom", path: ["earningsMax"] },
  );

export type DealInput = z.infer<typeof dealInputSchema>;

/** The only self-service profile setting: hide the earnings range. */
export const profilePatchSchema = z.object({
  hideEarnings: z.boolean(),
});

export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;

/* ------------------------- applications ------------------------- */

export const applicationInputSchema = z.object({
  message: text(10, 600, "Message"),
  experienceLevel: experienceLevelSchema,
  availabilityHours: z
    .number({ error: "Availability is required" })
    .int("Availability must be a whole number of hours")
    .min(1, "Availability must be at least 1 hour per week")
    .max(168, "Availability cannot exceed 168 hours per week"),
  pastResults: z
    .string()
    .trim()
    .max(1500, "Past results must be at most 1500 characters")
    .nullable()
    .default(null)
    .transform((value) => (value && value !== "" ? value : null)),
});

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

/** Admin review: accept/reject, and/or update the private note. */
export const applicationReviewSchema = z
  .object({
    status: applicationStatusSchema.optional(),
    adminNote: z
      .string()
      .trim()
      .max(2000, "Private note must be at most 2000 characters")
      .nullable()
      .optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.adminNote !== undefined,
    { error: "Nothing to update" },
  );

/* --------------------------- filters ---------------------------- */

export const offerFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  roleType: z.enum(["setter", "closer", "both", "all"]).default("all"),
  status: z.enum(["open", "paused", "closed", "all"]).default("open"),
});

export type OfferFilters = z.infer<typeof offerFiltersSchema>;

/** Parses loosely-typed query params without throwing. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): OfferFilters {
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const parsed = offerFiltersSchema.safeParse({
    q: single(params.q) || undefined,
    roleType: single(params.roleType) || "all",
    status: single(params.status) || "open",
  });

  return parsed.success
    ? parsed.data
    : { q: undefined, roleType: "all", status: "open" };
}
