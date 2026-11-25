export type RoleType = "setter" | "closer" | "both";
export type OfferStatus = "open" | "paused" | "closed";
export type ApplicationStatus = "pending" | "accepted" | "rejected";
/** Per-member membership tier; assigned by the admin (see PROGRESS.md #3). */
export type Tier = "free" | "pro" | "elite";
/** Saved-search / offer audience filter: `"all"` means no restriction. */
export type TierFilter = Tier | "all";
export type ExperienceLevel =
  | "entry"
  | "junior"
  | "mid"
  | "senior"
  | "expert";

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  tier: Tier;
  /** Public profile handle for /reps/[username]. */
  username: string;
  /** Rep hid their earnings range from everyone but themselves/admins. */
  hideEarnings: boolean;
  createdAt: string;
}

export interface Offer {
  id: string;
  title: string;
  company: string;
  description: string;
  roleType: RoleType;
  commission: string;
  payType: string;
  requirements: string;
  status: OfferStatus;
  expiresAt: string | null;
  featured: boolean;
  /** Paid plan only: members without this role never see the offer. */
  requiredRole: string | null;
  /** Audience tier — filters saved searches; everyone may still view. */
  tier: Tier;
  /** Numeric commission for the saved-search minimum filter; NULL = unknown. */
  commissionAmount: number | null;
  /** Partner portal: the partner who submitted it, or null for admin-made. */
  partnerId: string | null;
  /** Partner submissions start pending; only `approved` is public. */
  approvalStatus: "approved" | "pending" | "rejected";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Offer joined with the number of applications it has received. */
export interface OfferWithCounts extends Offer {
  applicationCount: number;
}

export interface Application {
  id: string;
  offerId: string;
  userId: string;
  message: string;
  experienceLevel: ExperienceLevel;
  availabilityHours: number;
  pastResults: string | null;
  status: ApplicationStatus;
  /** Admin-only private note; never sent to the applicant. */
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationWithOffer extends Application {
  offer: Pick<
    Offer,
    "id" | "title" | "company" | "status" | "roleType" | "expiresAt"
  >;
}

export interface ApplicationWithApplicant extends Application {
  applicant: Pick<User, "id" | "email" | "name">;
}

/** A rep's logged results on one offer (feature 5). */
export interface Deal {
  id: string;
  userId: string;
  offerId: string;
  dealsClosed: number;
  /** `YYYY-MM` the deals were closed in — drives the monthly leaderboard. */
  month: string;
  earningsMin: number | null;
  earningsMax: number | null;
  /** Set when the owning partner (or an admin) confirmed the numbers. */
  partnerConfirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Whop-backed billing (see src/lib/pricing.ts and src/lib/subscriptions.ts). */
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "granted"
  | "inactive";

export interface Subscription {
  id: string;
  userId: string;
  tier: Tier;
  status: SubscriptionStatus;
  /** `pro_monthly`, `elite_founding`, … — see PRICING_PLANS. */
  planKey: string | null;
  whopMembershipId: string | null;
  whopPlanId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Consumed a founding slot; never reset when the subscription lapses. */
  founding: boolean;
  foundingSlot: number | null;
  source: "whop" | "admin";
  createdAt: string;
  updatedAt: string;
}

export interface DealWithOffer extends Deal {
  offer: Pick<Offer, "id" | "title" | "company" | "status">;
}

export const ROLE_TYPE_LABELS: Record<RoleType, string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Setter + Closer",
};

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  open: "Open",
  paused: "Paused",
  closed: "Closed",
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  entry: "Entry (0–1 yrs)",
  junior: "Junior (1–2 yrs)",
  mid: "Mid (2–4 yrs)",
  senior: "Senior (4–7 yrs)",
  expert: "Expert (7+ yrs)",
};

export const EXPERIENCE_LEVELS: ExperienceLevel[] = [
  "entry",
  "junior",
  "mid",
  "senior",
  "expert",
];

export const ROLE_TYPES: RoleType[] = ["setter", "closer", "both"];
export const OFFER_STATUSES: OfferStatus[] = ["open", "paused", "closed"];
export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "pending",
  "accepted",
  "rejected",
];

export const PAY_TYPES = [
  "Commission only",
  "Base + commission",
  "Hourly",
  "Salary",
  "Project fee",
] as const;
