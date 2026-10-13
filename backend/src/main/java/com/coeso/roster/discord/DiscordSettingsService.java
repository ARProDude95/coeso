package com.coeso.roster.discord;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.WorkspaceDiscord;
import com.coeso.roster.repo.Repositories.WorkspaceDiscordRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Connects a workspace to a Discord server: guild id, notification channel id
 * and a role map (Discord role id -> workspace role). Admin/owner only. The
 * role map may only grant rep, manager or admin — owner is rejected outright,
 * both here and at sync time, so login can never escalate anyone to owner.
 */
@Service
public class DiscordSettingsService {

    public record SettingsRequest(String guildId, String notificationChannelId,
                                  Map<String, String> roleMap) {
    }

    public record SettingsResponse(boolean connected, String guildId,
                                   String notificationChannelId, Map<String, String> roleMap) {
    }

    private final WorkspaceDiscordRepository workspaceDiscord;
    private final ObjectMapper objectMapper;
    private final AuditService auditService;

    public DiscordSettingsService(WorkspaceDiscordRepository workspaceDiscord,
                                  ObjectMapper objectMapper, AuditService auditService) {
        this.workspaceDiscord = workspaceDiscord;
        this.objectMapper = objectMapper;
        this.auditService = auditService;
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public SettingsResponse get() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        return workspaceDiscord.findByWorkspaceId(workspaceId)
                .map(this::toResponse)
                .orElse(new SettingsResponse(false, null, null, Map.of()));
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public SettingsResponse save(SettingsRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        String guildId = requireDigits(request.guildId(), "guildId");
        String channelId = request.notificationChannelId() == null
                || request.notificationChannelId().isBlank()
                ? null
                : requireDigits(request.notificationChannelId().trim(), "notificationChannelId");
        Map<String, String> roleMap = validateRoleMap(request.roleMap());

        WorkspaceDiscord connection = workspaceDiscord.findByWorkspaceId(workspaceId)
                .orElseGet(WorkspaceDiscord::new);
        boolean creating = connection.getId() == null;
        connection.setWorkspaceId(workspaceId);
        connection.setGuildId(guildId);
        connection.setNotificationChannelId(channelId);
        connection.setRoleMap(writeRoleMap(roleMap));
        workspaceDiscord.save(connection);

        auditService.record(
                creating ? AuditLog.ACTION_CREATE : AuditLog.ACTION_UPDATE,
                "workspace_discord", connection.getId(),
                Map.of("guildId", guildId,
                        "notificationChannelId", channelId == null ? "" : channelId,
                        "roleMap", writeRoleMap(roleMap)));
        return toResponse(connection);
    }

    // ---------------------------------------------------------------- helpers

    /** Role map values must be grantable workspace roles; owner is rejected. */
    private Map<String, String> validateRoleMap(Map<String, String> roleMap) {
        Map<String, String> normalized = new LinkedHashMap<>();
        if (roleMap == null || roleMap.isEmpty()) {
            return normalized;
        }
        for (Map.Entry<String, String> entry : roleMap.entrySet()) {
            String discordRoleId = entry.getKey() == null ? "" : entry.getKey().trim();
            String target = entry.getValue() == null ? "" : entry.getValue().trim();
            if (discordRoleId.isEmpty() || !discordRoleId.matches("\\d{1,40}")) {
                throw new BadRequestException(
                        "roleMap keys must be Discord role ids (numeric): '" + discordRoleId + "'");
            }
            if (DiscordRoleSyncService.parseGrantable(target) == null) {
                throw new BadRequestException(
                        "roleMap values must be rep, manager or admin; the owner role"
                                + " can never be granted through Discord");
            }
            normalized.put(discordRoleId, target.toUpperCase(Locale.ROOT));
        }
        return normalized;
    }

    private String writeRoleMap(Map<String, String> roleMap) {
        if (roleMap.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(roleMap);
        } catch (JsonProcessingException e) {
            throw new BadRequestException("roleMap could not be serialized");
        }
    }

    private Map<String, String> readRoleMap(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<Map<String, String>>() {
            });
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private SettingsResponse toResponse(WorkspaceDiscord connection) {
        return new SettingsResponse(true, connection.getGuildId(),
                connection.getNotificationChannelId(), readRoleMap(connection.getRoleMap()));
    }

    private static String requireDigits(String value, String field) {
        String trimmed = value == null ? "" : value.trim();
        if (!trimmed.matches("\\d{1,40}")) {
            throw new BadRequestException(field + " must be a numeric Discord id");
        }
        return trimmed;
    }
}
