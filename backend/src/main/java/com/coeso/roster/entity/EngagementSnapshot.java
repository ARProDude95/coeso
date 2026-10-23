package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import org.hibernate.annotations.Filter;

/**
 * One member's engagement window on one day: weighted activity over the
 * trailing 30 days plus days-inactive. Rows are append-only per day (the
 * unique key is workspace + user + snapshot_date) and never deleted, so the
 * churn detector always has a previous snapshot to compare against.
 */
@Entity
@Table(name = "engagement_snapshots")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class EngagementSnapshot extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "snapshot_date", nullable = false)
    private LocalDate snapshotDate;

    @Column(nullable = false)
    private int score;

    @Column(name = "audit_actions", nullable = false)
    private int auditActions;

    @Column(name = "pod_checkins", nullable = false)
    private int podCheckins;

    @Column(name = "pod_messages", nullable = false)
    private int podMessages;

    @Column(name = "intro_activity", nullable = false)
    private int introActivity;

    @Column(nullable = false)
    private int bookings;

    @Column(name = "days_inactive", nullable = false)
    private int daysInactive;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public LocalDate getSnapshotDate() {
        return snapshotDate;
    }

    public void setSnapshotDate(LocalDate snapshotDate) {
        this.snapshotDate = snapshotDate;
    }

    public int getScore() {
        return score;
    }

    public void setScore(int score) {
        this.score = score;
    }

    public int getAuditActions() {
        return auditActions;
    }

    public void setAuditActions(int auditActions) {
        this.auditActions = auditActions;
    }

    public int getPodCheckins() {
        return podCheckins;
    }

    public void setPodCheckins(int podCheckins) {
        this.podCheckins = podCheckins;
    }

    public int getPodMessages() {
        return podMessages;
    }

    public void setPodMessages(int podMessages) {
        this.podMessages = podMessages;
    }

    public int getIntroActivity() {
        return introActivity;
    }

    public void setIntroActivity(int introActivity) {
        this.introActivity = introActivity;
    }

    public int getBookings() {
        return bookings;
    }

    public void setBookings(int bookings) {
        this.bookings = bookings;
    }

    public int getDaysInactive() {
        return daysInactive;
    }

    public void setDaysInactive(int daysInactive) {
        this.daysInactive = daysInactive;
    }
}
