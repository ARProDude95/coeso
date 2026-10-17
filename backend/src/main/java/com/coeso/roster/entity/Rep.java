package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinColumns;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.time.LocalDate;
import java.time.LocalDateTime;

/** A sales rep in a workspace's roster. Soft-deleted via deleted_at. */
@Entity
@Table(name = "reps")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class Rep extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(length = 255)
    private String email;

    @Column(name = "discord_user_id", length = 40)
    private String discordUserId;

    @Column(name = "vertical_id")
    private Long verticalId;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "vertical_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Vertical vertical;

    @Column(name = "status_id")
    private Long statusId;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "status_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private RepStatus status;

    @Column(name = "experience_level_id")
    private Long experienceLevelId;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "experience_level_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private ExperienceLevel experienceLevel;

    @Column(length = 4000)
    private String notes;

    @Column(name = "joined_date")
    private LocalDate joinedDate;

    // ------------------------------------------------ Phase 6 profile fields
    // (skills / languages / preferred verticals / photo live in their own
    // tenant tables; these are the flat profile columns.)

    @Column
    private String bio;

    /** IANA zone id, e.g. {@code Europe/Berlin}. */
    @Column(length = 64)
    private String timezone;

    /** Weekly availability in hours (0–168). */
    @Column(name = "hours_per_week")
    private Integer hoursPerWeek;

    /** First date the rep can start. */
    @Column(name = "available_from")
    private LocalDate availableFrom;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getDiscordUserId() {
        return discordUserId;
    }

    public void setDiscordUserId(String discordUserId) {
        this.discordUserId = discordUserId;
    }

    public Long getVerticalId() {
        return verticalId;
    }

    public void setVerticalId(Long verticalId) {
        this.verticalId = verticalId;
    }

    public Vertical getVertical() {
        return vertical;
    }

    public void setVertical(Vertical vertical) {
        this.vertical = vertical;
    }

    public Long getStatusId() {
        return statusId;
    }

    public void setStatusId(Long statusId) {
        this.statusId = statusId;
    }

    public RepStatus getStatus() {
        return status;
    }

    public void setStatus(RepStatus status) {
        this.status = status;
    }

    public Long getExperienceLevelId() {
        return experienceLevelId;
    }

    public void setExperienceLevelId(Long experienceLevelId) {
        this.experienceLevelId = experienceLevelId;
    }

    public ExperienceLevel getExperienceLevel() {
        return experienceLevel;
    }

    public void setExperienceLevel(ExperienceLevel experienceLevel) {
        this.experienceLevel = experienceLevel;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public LocalDate getJoinedDate() {
        return joinedDate;
    }

    public void setJoinedDate(LocalDate joinedDate) {
        this.joinedDate = joinedDate;
    }

    public LocalDateTime getDeletedAt() {
        return deletedAt;
    }

    public void setDeletedAt(LocalDateTime deletedAt) {
        this.deletedAt = deletedAt;
    }

    public String getBio() {
        return bio;
    }

    public void setBio(String bio) {
        this.bio = bio;
    }

    public String getTimezone() {
        return timezone;
    }

    public void setTimezone(String timezone) {
        this.timezone = timezone;
    }

    public Integer getHoursPerWeek() {
        return hoursPerWeek;
    }

    public void setHoursPerWeek(Integer hoursPerWeek) {
        this.hoursPerWeek = hoursPerWeek;
    }

    public LocalDate getAvailableFrom() {
        return availableFrom;
    }

    public void setAvailableFrom(LocalDate availableFrom) {
        this.availableFrom = availableFrom;
    }
}
