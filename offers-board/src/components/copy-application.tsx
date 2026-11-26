"use client";

import { useToast } from "@/components/toast";
import type { Application } from "@/lib/store";

const STATUS_LABEL: Record<Application["status"], string> = {
  new: "Received",
  reviewing: "In review",
  shortlisted: "Shortlisted",
  hired: "Hired",
};

/** Markdown, shaped for a Discord message: bold labels, handle in backticks. */
export function formatApplicationForDiscord(application: Application): string {
  const received = new Date(application.created_at).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short", year: "numeric" },
  );
  const handle = application.discord.trim();

  const lines = [
    `**Application · Coeso Offers Board**`,
    `**Member:** ${application.account_username || application.name}`,
    `**Discord:** \`${handle}\``,
    `**Email:** ${application.email}`,
    `**Offer:** ${application.offer_title ?? "—"}${
      application.offer_company ? ` — ${application.offer_company}` : ""
    }`,
    `**Hours / week:** ${application.availability_hours}`,
    `**Status:** ${STATUS_LABEL[application.status]}`,
    `**Received:** ${received}`,
    "",
    "**Experience**",
    application.experience.trim(),
  ];

  if (application.message.trim()) {
    lines.push("", "**Notes**", application.message.trim());
  }

  return lines.join("\n");
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older or locked-down browsers: fall back to a hidden textarea.
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(area);
      return copied;
    } catch {
      return false;
    }
  }
}

export function CopyApplication({ application }: { application: Application }) {
  const toast = useToast();

  async function copy() {
    const copied = await writeClipboard(formatApplicationForDiscord(application));
    toast(
      copied
        ? `Application from ${application.account_username || application.name} copied — paste it into Discord.`
        : "Could not copy. Your browser blocked clipboard access.",
      copied ? "success" : "error",
    );
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="font-mono text-[10px] uppercase tracking-[0.2em] text-mute underline decoration-line underline-offset-4 hover:text-paper"
      aria-label={`Copy application from ${
        application.account_username || application.name
      } for Discord`}
    >
      Copy
    </button>
  );
}
