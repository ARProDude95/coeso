package com.coeso.roster.discord;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.User;
import com.coeso.roster.entity.WorkspaceDiscord;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.WorkspaceDiscordRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Syncs a member's workspace role from their Discord guild roles on login.
 *
 * <p>The workspace's {@code workspace_discord.role_map} maps a Discord role id
 * to a workspace role. When the member holds one or more mapped Discord roles,
 * the highest mapped workspace role wins and is written to the membership.
 *
 * <p>Hard limits (asserted by tests):
 * <ul>
 *   <li>The owner role is NEVER granted or revoked this way — mappings that
 *       target owner are ignored, and owner memberships are never touched.</li>
 *   <li>A failure to reach Discord (or a member not in the guild) simply
 *       leaves every membership unchanged; role sync is best-effort.</li>
 * </ul>
 */
@Service
public class DiscordRoleSyncService {

    private static final Logger log = LoggerFactory.getLogger(DiscordRoleSyncService.class);

    private final MembershipRepository memberships;
    private final WorkspaceDiscordRepository workspaceDiscord;
    private final DiscordApiClient discordApi;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;

    public DiscordRoleSyncService(MembershipRepository memberships,
                                  WorkspaceDiscordRepository workspaceDiscord,
                                  DiscordApiClient discordApi,
                                  ObjectMapper objectMapper,
                                  AuditService auditService) {
        this.memberships = memberships;
        this.workspaceDiscord = workspaceDiscord;
        this.discordApi = discordApi;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
    }

    /**
     * Applies the Discord role map to every workspace the user belongs to.
     * Called on Discord login, outside any tenant context on purpose: the loop
     * crosses workspaces, and each membership carries its own workspace id.
     */
    public void syncRoles(User user) {
        if (user.getDiscordId() == null) {
            return;
        }
        for (Membership membership : memberships.findAllByUserId(user.getId())) {
            try {
                syncMembership(user, membership);
            } catch (RuntimeException e) {
                // A broken connection or bad role map must never block login.
                log.warn("Discord role sync failed for workspace {}: {}",
                        membership.getWorkspaceId(), e.toString());
            }
        }
    }

    private void syncMembership(User user, Membership membership) {
        if (membership.getRole() == WorkspaceRole.OWNER) {
            return; // owner is never granted or revoked via Discord
        }
        WorkspaceDiscord connection = workspaceDiscord
                .findByWorkspaceId(membership.getWorkspaceId()).orElse(null);
        if (connection == null || connection.getRoleMap() == null
                || connection.getRoleMap().isBlank()) {
            return;
        }
        Map<String, String> roleMap = parseRoleMap(connection.getRoleMap());
        if (roleMap.isEmpty()) {
            return;
        }
        List<String> memberRoleIds = discordApi.memberRoleIds(
                connection.getGuildId(), user.getDiscordId());
        if (memberRoleIds.isEmpty()) {
            return; // not in the guild, or Discord unreachable: leave role as is
        }

        WorkspaceRole target = null;
        for (String roleId : memberRoleIds) {
            String mapped = roleMap.get(roleId);
            if (mapped == null) {
                continue;
            }
            WorkspaceRole candidate = parseGrantable(mapped);
            if (candidate == null) {
                continue; // owner (or junk) in a role map is ignored, never granted
            }
            if (target == null || candidate.compareTo(target) > 0) {
                target = candidate;
            }
        }
        if (target == null || target == membership.getRole()) {
            return;
        }
        WorkspaceRole previous = membership.getRole();
        membership.setRole(target);
        memberships.save(membership);
        auditService.recordUnattributed(membership.getWorkspaceId(), AuditLog.ACTION_UPDATE,
                "membership", membership.getId(),
                Map.of("userId", user.getId(),
                        "from", previous.name(),
                        "to", target.name(),
                        "source", "discord_role_sync"));
    }

    /** Parses the stored JSON map; invalid JSON yields an empty map (no sync). */
    private Map<String, String> parseRoleMap(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() {
            });
        } catch (Exception e) {
            log.warn("workspace_discord role_map is not valid JSON; skipping role sync");
            return Map.of();
        }
    }

    /**
     * The workspace role a mapping may grant: rep, manager or admin only.
     * Returns null for owner (never grantable) and for unparseable values.
     */
    static WorkspaceRole parseGrantable(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String value = raw.trim().toUpperCase(Locale.ROOT);
        if (value.equals(WorkspaceRole.OWNER.name())) {
            return null;
        }
        try {
            return WorkspaceRole.valueOf(value);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
