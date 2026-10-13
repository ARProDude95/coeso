package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinColumns;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.time.LocalDateTime;

/**
 * A rep assigned to an offer. The generated column active_rep_id (rep_id while
 * status = 'active', NULL otherwise) plus the unique key
 * (workspace_id, active_rep_id) enforces at most one active placement per rep
 * at the database level. The generated column is deliberately not mapped here.
 */
@Entity
@Table(name = "placements")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class Placement extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "offer_id", nullable = false)
    private Long offerId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "offer_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Offer offer;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "rep_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Rep rep;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PlacementStatus status = PlacementStatus.ACTIVE;

    @Column(name = "placed_at", nullable = false)
    private LocalDateTime placedAt;

    @Column(name = "ended_at")
    private LocalDateTime endedAt;

    @Column(name = "end_reason", length = 255)
    private String endReason;

    /** Acting user id (global users table, not a tenant FK). */
    @Column(name = "placed_by")
    private Long placedBy;

    @PrePersist
    void onPersist() {
        if (placedAt == null) {
            placedAt = LocalDateTime.now();
        }
    }

    public Long getId() {
        return id;
    }

    public Long getOfferId() {
        return offerId;
    }

    public void setOfferId(Long offerId) {
        this.offerId = offerId;
    }

    public Offer getOffer() {
        return offer;
    }

    public void setOffer(Offer offer) {
        this.offer = offer;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public Rep getRep() {
        return rep;
    }

    public void setRep(Rep rep) {
        this.rep = rep;
    }

    public PlacementStatus getStatus() {
        return status;
    }

    public void setStatus(PlacementStatus status) {
        this.status = status;
    }

    public LocalDateTime getPlacedAt() {
        return placedAt;
    }

    public void setPlacedAt(LocalDateTime placedAt) {
        this.placedAt = placedAt;
    }

    public LocalDateTime getEndedAt() {
        return endedAt;
    }

    public void setEndedAt(LocalDateTime endedAt) {
        this.endedAt = endedAt;
    }

    public String getEndReason() {
        return endReason;
    }

    public void setEndReason(String endReason) {
        this.endReason = endReason;
    }

    public Long getPlacedBy() {
        return placedBy;
    }

    public void setPlacedBy(Long placedBy) {
        this.placedBy = placedBy;
    }
}
