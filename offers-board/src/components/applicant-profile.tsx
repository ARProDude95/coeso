import type { Application } from "@/lib/store";

function splitSkills(skills: string | null | undefined): string[] {
  return (skills ?? "")
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The applicant's own profile, shown next to their application so the owner can
 * read it while reviewing. Read-only: members edit their profile themselves.
 */
export function ApplicantProfile({
  application,
}: {
  application: Application;
}) {
  const headline = application.profile_headline?.trim() ?? "";
  const location = application.profile_location?.trim() ?? "";
  const bio = application.profile_bio?.trim() ?? "";
  const loom = application.profile_loom_url?.trim() ?? "";
  const website = application.profile_website_url?.trim() ?? "";
  const skills = splitSkills(application.profile_skills);

  if (!application.account_id) {
    return (
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-mute">
        No member account
      </p>
    );
  }

  if (!headline && !location && !bio && !loom && !website && skills.length === 0) {
    return (
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-mute">
        No profile filled in
      </p>
    );
  }

  return (
    <div className="mt-2 max-w-xs border-l border-line pl-3">
      {headline ? (
        <p className="text-xs leading-relaxed text-paper">{headline}</p>
      ) : null}
      {location || application.account_username ? (
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-mute">
          {[application.account_username, location].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {skills.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {skills.map((skill) => (
            <li
              key={skill}
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-mute"
            >
              {skill}
            </li>
          ))}
        </ul>
      ) : null}
      {bio ? (
        <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-mute">
          {bio}
        </p>
      ) : null}
      {loom || website ? (
        <p className="mt-1.5 flex flex-wrap gap-3 font-mono text-[9px] uppercase tracking-[0.18em]">
          {loom ? (
            <a
              className="text-ember underline decoration-ember/40 underline-offset-4 hover:text-paper"
              href={loom}
              target="_blank"
              rel="noreferrer noopener"
            >
              Loom
            </a>
          ) : null}
          {website ? (
            <a
              className="text-mute underline decoration-line underline-offset-4 hover:text-paper"
              href={website}
              target="_blank"
              rel="noreferrer noopener"
            >
              {hostOf(website)}
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
