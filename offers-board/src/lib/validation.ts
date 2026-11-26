import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const offerInput = z.object({
  title: text(140),
  company: text(120),
  role_type: z.enum(["setter", "closer", "both"]),
  commission: text(140),
  pay_type: text(80),
  description: text(4000),
  requirements: z.string().trim().max(4000).default(""),
  featured: z.boolean().default(false),
});

export const applicationInput = z.object({
  offer_id: text(80),
  name: text(120),
  email: z
    .string()
    .trim()
    .min(3)
    .max(200)
    .regex(EMAIL, "Enter a valid email address"),
  discord: text(80),
  experience: text(400),
  availability_hours: z.coerce.number().int().min(1).max(80),
  message: z.string().trim().max(2000).default(""),
});

export const accountInput = z.object({
  username: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9._-]{3,30}$/,
      "Use 3–30 letters, numbers, dots, dashes or underscores",
    ),
  role: z.enum(["admin", "viewer"]).default("viewer"),
});

export type OfferInput = z.infer<typeof offerInput>;
export type ApplicationInput = z.infer<typeof applicationInput>;
export type AccountInput = z.infer<typeof accountInput>;
