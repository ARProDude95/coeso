import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/profile-form";
import { getSession } from "@/lib/auth";
import { getAccountById, getProfile, type Profile } from "@/lib/store";

export const dynamic = "force-dynamic";

const DETAILS = [
  "display_name",
  "headline",
  "location",
  "bio",
  "experience",
  "skills",
  "loom_url",
  "website_url",
] as const;

const LABELS: Record<(typeof DETAILS)[number], string> = {
  display_name: "name",
  headline: "headline",
  location: "location",
  bio: "bio",
  experience: "experience",
  skills: "skills",
  loom_url: "Loom",
  website_url: "website",
};

function initials(value: string): string {
  const parts = value
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function splitSkills(skills: string): string[] {
  return skills
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [profile, account] = await Promise.all([
    getProfile(session.id),
    getAccountById(session.id),
  ]);

  const name = profile?.display_name?.trim() || session.username;
  const filled = DETAILS.filter((field) =>
    Boolean(profile?.[field]?.trim()),
  );
  const missing = DETAILS.length - filled.length;
  const strength = Math.round((filled.length / DETAILS.length) * 100);
  const skills = splitSkills(profile?.skills ?? "");
  const roles = splitLines(profile?.experience ?? "");

  return (
    <main className="mx-auto max-w-4xl px-5">
      <section className="border-b border-line py-14">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-ember">
          Coeso · Member profile
        </p>
        <h1 className="mt-5 font-display text-4xl leading-[0.95] sm:text-5xl">
          {name}
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-mute">
          This is the profile Coeso reads when you apply. The bits you fill in
          sit at the top; the form underneath adds the rest.
        </p>
      </section>

      <section className="card mt-8 p-6 sm:p-8">
        <div className="flex flex-wrap items-start gap-5">
          <span className="monogram h-16 w-16 text-xl" aria-hidden>
            {initials(name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight">{name}</h2>
            <p className="mt-1 text-sm text-mute">
              {profile?.headline?.trim() || "No headline yet."}
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
              @{session.username}
              {profile?.location?.trim() ? ` · ${profile.location.trim()}` : ""}
              {account ? ` · member since ${formatMonth(account.created_at)}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-7">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
            <span>Profile strength</span>
            <span className="text-paper">{strength}%</span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-ember transition-[width]"
              style={{ width: `${strength}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-mute">
            {missing === 0
              ? "Complete. Everything Coeso looks at is filled in."
              : `${missing} detail${missing === 1 ? "" : "s"} left — ${DETAILS.filter(
                  (field) => !filled.includes(field),
                )
                  .map((field) => LABELS[field])
                  .join(", ")}.`}
          </p>
        </div>

        {skills.length > 0 ? (
          <ul className="mt-6 flex flex-wrap gap-2">
            {skills.map((skill) => (
              <li key={skill} className="pill cursor-default">
                {skill}
              </li>
            ))}
          </ul>
        ) : null}

        {profile?.bio?.trim() ? (
          <div className="mt-6 border-t border-line pt-5">
            <p className="eyebrow">In brief</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-paper/90">
              {profile.bio.trim()}
            </p>
          </div>
        ) : null}

        {roles.length > 0 ? (
          <div className="mt-6 border-t border-line pt-5">
            <p className="eyebrow">Experience</p>
            <ul className="mt-3 space-y-2">
              {roles.map((line) => (
                <li
                  key={line}
                  className="text-sm leading-relaxed text-paper/90"
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {profile?.loom_url || profile?.website_url ? (
          <div className="mt-6 flex flex-wrap gap-3 border-t border-line pt-5">
            {profile.loom_url ? (
              <a
                className="btn"
                href={profile.loom_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Watch my Loom
              </a>
            ) : null}
            {profile.website_url ? (
              <a
                className="btn"
                href={profile.website_url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Website
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl">
          {profile ? "Edit your details" : "Build your profile"}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-mute">
          Everything here is optional, and you can change it whenever. Reload the
          page after saving and the summary above fills in.
        </p>
        <div className="mt-6">
          <ProfileForm profile={profile as Profile | null} />
        </div>
      </section>
    </main>
  );
}
