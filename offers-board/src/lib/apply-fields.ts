export type ApplyFieldName =
  | "email"
  | "discord"
  | "experience"
  | "availability_hours"
  | "message";

export type ApplyFields = Record<ApplyFieldName, string>;
export type ApplyErrors = Partial<Record<ApplyFieldName, string>>;

export const APPLY_FIELD_ORDER: ApplyFieldName[] = [
  "email",
  "discord",
  "experience",
  "availability_hours",
  "message",
];

export const EMPTY_APPLY_FIELDS: ApplyFields = {
  email: "",
  discord: "",
  experience: "",
  availability_hours: "",
  message: "",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const applyDraftKey = (offerId: string) => `coeso.apply.draft.${offerId}`;

/** Mirrors the server's memberApplicationInput rules, phrased for a human. */
export function validateApplyFields(fields: ApplyFields): ApplyErrors {
  const errors: ApplyErrors = {};

  const email = fields.email.trim();
  if (!email) errors.email = "We need an email to reply to you.";
  else if (!EMAIL.test(email))
    errors.email = "That does not look like an email address.";

  if (!fields.discord.trim())
    errors.discord = "Your Discord handle, so Coeso can message you.";

  if (!fields.experience.trim())
    errors.experience = "One or two lines on what you have done.";
  else if (fields.experience.trim().length < 10)
    errors.experience = "A little more detail, please.";

  const hours = Number(fields.availability_hours);
  if (!fields.availability_hours.trim())
    errors.availability_hours = "Roughly how many hours a week?";
  else if (!Number.isInteger(hours) || hours < 1 || hours > 80)
    errors.availability_hours = "A whole number between 1 and 80.";

  if (fields.message.length > 2000)
    errors.message = "Keep it under 2000 characters.";

  return errors;
}

const EMPTY: ApplyFields = EMPTY_APPLY_FIELDS;

/** Coerce whatever came out of localStorage into a full, safe field set. */
export function normalizeDraft(raw: unknown): ApplyFields {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY };
  const source = raw as Record<string, unknown>;
  const read = (key: ApplyFieldName) =>
    typeof source[key] === "string" ? (source[key] as string) : "";

  return {
    email: read("email"),
    discord: read("discord"),
    experience: read("experience"),
    availability_hours: read("availability_hours"),
    message: read("message"),
  };
}
