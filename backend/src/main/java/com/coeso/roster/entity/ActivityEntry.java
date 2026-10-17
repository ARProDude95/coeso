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
 * One logged activity on a placement. The rep is denormalised from the
 * placement (single source of truth stays placements.rep_id). Integer values
 * only: counts, or money in minor units for currency metrics.
 */
@Entity
@Table(name = "activity_entries")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class ActivityEntry extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "placement_id", nullable = false)
    private Long placementId;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(name = "metric_type_id", nullable = false)
    private Long metricTypeId;

    @Column(name = "occurred_on", nullable = false)
    private LocalDate occurredOn;

    @Column(name = "value_minor", nullable = false)
    private long valueMinor;

    @Column(length = 255)
    private String notes;

    /** The user who logged the row (null for scripted imports). */
    @Column(name = "logged_by")
    private Long loggedBy;

    public Long getId() {
        return id;
    }

    public Long getPlacementId() {
        return placementId;
    }

    public void setPlacementId(Long placementId) {
        this.placementId = placementId;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public Long getMetricTypeId() {
        return metricTypeId;
    }

    public void setMetricTypeId(Long metricTypeId) {
        this.metricTypeId = metricTypeId;
    }

    public LocalDate getOccurredOn() {
        return occurredOn;
    }

    public void setOccurredOn(LocalDate occurredOn) {
        this.occurredOn = occurredOn;
    }

    public long getValueMinor() {
        return valueMinor;
    }

    public void setValueMinor(long valueMinor) {
        this.valueMinor = valueMinor;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public Long getLoggedBy() {
        return loggedBy;
    }

    public void setLoggedBy(Long loggedBy) {
        this.loggedBy = loggedBy;
    }
}