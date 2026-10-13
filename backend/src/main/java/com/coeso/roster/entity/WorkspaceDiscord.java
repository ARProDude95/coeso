package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/** Workspace <-> Discord guild connection (phase 5). One row per workspace. */
@Entity
@Table(name = "workspace_discord")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class WorkspaceDiscord extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "guild_id", nullable = false, length = 40)
    private String guildId;

    @Column(name = "notification_channel_id", length = 40)
    private String notificationChannelId;

    /** JSON map: Discord role id -> workspace role. */
    @Column(name = "role_map", columnDefinition = "json")
    private String roleMap;

    public Long getId() {
        return id;
    }

    public String getGuildId() {
        return guildId;
    }

    public void setGuildId(String guildId) {
        this.guildId = guildId;
    }

    public String getNotificationChannelId() {
        return notificationChannelId;
    }

    public void setNotificationChannelId(String notificationChannelId) {
        this.notificationChannelId = notificationChannelId;
    }

    public String getRoleMap() {
        return roleMap;
    }

    public void setRoleMap(String roleMap) {
        this.roleMap = roleMap;
    }
}
