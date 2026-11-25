import "server-only";
import { env } from "./env";

/**
 * Best-effort Discord bot DMs (PROGRESS #2). Nothing here is required: with
 * no bot token, no guild id, or no `users.discord_id` (today: every account),
 * the call returns `false` and the caller's in-app notification stands.
 *
 * A DM needs a Discord user id, which only a future Discord sync will put on
 * an account — so this path is real code, just unconfigured.
 */
export async function sendBotDm(
  discordId: string | null,
  content: string,
): Promise<boolean> {
  const token = env.discordBotToken;
  const guildId = env.discordGuildId;
  if (!token || !guildId || !discordId) return false;

  const headers = {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // Open (or fetch) the DM channel with the recipient.
    const channelResponse = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient_id: discordId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!channelResponse.ok) {
      console.error(`[discord-bot] DM channel refused (${channelResponse.status})`);
      return false;
    }

    const channel = (await channelResponse.json()) as { id?: string };
    if (!channel.id) return false;

    const messageResponse = await fetch(
      `https://discord.com/api/v10/channels/${channel.id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ content: content.slice(0, 2000) }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!messageResponse.ok) {
      console.error(`[discord-bot] DM rejected (${messageResponse.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[discord-bot] failed to send DM:", error);
    return false;
  }
}

/**
 * Grants or revokes a guild role for a member. Same contract as the DM: real
 * code, but it only runs when the bot, guild and role id are all configured
 * and the account has a Discord id.
 */
export async function setGuildRole(
  discordId: string | null,
  roleId: string,
  grant: boolean,
): Promise<boolean> {
  const token = env.discordBotToken;
  const guildId = env.discordGuildId;
  if (!token || !guildId || !discordId || !roleId) return false;

  try {
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      {
        method: grant ? "PUT" : "DELETE",
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok && response.status !== 204) {
      console.error(`[discord-bot] role change rejected (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[discord-bot] failed to change role:", error);
    return false;
  }
}
