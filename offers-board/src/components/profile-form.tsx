"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Profile } from "@/lib/store";

const FIELDS = [
  {
    name: "display_name",
    label: "Name",
    placeholder: "Jordan Reyes",
    max: 80,
    hint: "What Coeso shows if it features you.",
  },
  {
    name: "headline",
    label: "Headline",
    placeholder: "High-ticket closer — B2B SaaS",
    max: 120,
    hint: "One line that says what you do.",
  },
  {
    name: "location",
    label: "Location",
    placeholder: "Lisbon · works US Eastern",
    max: 80,
    hint: "City and the hours you actually work.",
  },
] as const;

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setSending(true);
    setError("");
    setSaved(false);

    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        display_name: data.get("display_name"),
        headline: data.get("headline"),
        location: data.get("location"),
        bio: data.get("bio"),
        experience: data.get("experience"),
        skills: data.get("skills"),
        loom_url: data.get("loom_url"),
        website_url: data.get("website_url"),
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: Array<{ path?: string[]; message?: string }>;
      } | null;
      const issue = payload?.issues?.[0]?.message;
      setError(
        payload?.error === "unauthorized"
          ? "Your session expired — sign in again."
          : issue
            ? `${payload?.issues?.[0]?.path?.[0] ?? "Field"}: ${issue}`
            : "Could not save your profile. Check the fields.",
      );
      setSending(false);
      return;
    }

    setSending(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      {FIELDS.map((field) => (
        <div key={field.name}>
          <label className="label" htmlFor={`profile-${field.name}`}>
            {field.label}
          </label>
          <input
            id={`profile-${field.name}`}
            name={field.name}
            maxLength={field.max}
            className="field"
            defaultValue={profile?.[field.name] ?? ""}
            placeholder={field.placeholder}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
            {field.hint}
          </p>
        </div>
      ))}

      <div className="sm:col-span-2">
        <label className="label" htmlFor="profile-bio">
          Bio
        </label>
        <textarea
          id="profile-bio"
          name="bio"
          rows={4}
          maxLength={1200}
          className="field resize-y"
          defaultValue={profile?.bio ?? ""}
          placeholder="Who you are, what you sell, and what you want next."
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor="profile-experience">
          Experience (one role per line)
        </label>
        <textarea
          id="profile-experience"
          name="experience"
          rows={4}
          maxLength={3000}
          className="field resize-y"
          defaultValue={profile?.experience ?? ""}
          placeholder={"2024–now · Closer, Northwind Growth · 18% of contract value\n2022–2024 · Setter, Halden & Co · 14 calls a week"}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor="profile-skills">
          Skills (comma separated)
        </label>
        <input
          id="profile-skills"
          name="skills"
          maxLength={300}
          className="field"
          defaultValue={profile?.skills ?? ""}
          placeholder="Discovery calls, two-call close, DTC, solar"
        />
      </div>

      <div>
        <label className="label" htmlFor="profile-loom">
          Loom
        </label>
        <input
          id="profile-loom"
          name="loom_url"
          maxLength={300}
          className="field"
          defaultValue={profile?.loom_url ?? ""}
          placeholder="loom.com/share/…"
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
          A short pitch recording. Paste the link without https:// and it is
          added for you.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="profile-website">
          Website or portfolio
        </label>
        <input
          id="profile-website"
          name="website_url"
          maxLength={300}
          className="field"
          defaultValue={profile?.website_url ?? ""}
          placeholder="yourdomain.com"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember sm:col-span-2">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p className="rounded-lg border border-line bg-coal px-3 py-2 text-xs text-mute sm:col-span-2">
          Saved. Your profile above is up to date.
        </p>
      ) : null}

      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? "Saving…" : profile ? "Save profile" : "Create profile"}
        </button>
        <span className="text-[11px] text-mute">
          Only you and Coeso&rsquo;s Owner can see this.
        </span>
      </div>
    </form>
  );
}
