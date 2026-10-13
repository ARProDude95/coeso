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
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;
import java.time.LocalDateTime;

/** A rep's request to join an offer; managers approve or decline (phase 3). */
@Entity
@Table(name = "placement_requests")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class PlacementRequest extends TimestampedTenantEntity {

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

    @Column(name = "requested_by")
    private Long requestedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PlacementRequestStatus status = PlacementRequestStatus.PENDING;

    @Column(name = "decided_by")
    private Long decidedBy;

    @Column(name = "decided_at")
    private LocalDateTime decidedAt;

    @Column(length = 4000)
    private String note;

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

    public Long getRequestedBy() {
        return requestedBy;
    }

    public void setRequestedBy(Long requestedBy) {
        this.requestedBy = requestedBy;
    }

    public PlacementRequestStatus getStatus() {
        return status;
    }

    public void setStatus(PlacementRequestStatus status) {
        this.status = status;
    }

    public Long getDecidedBy() {
        return decidedBy;
    }

    public void setDecidedBy(Long decidedBy) {
        this.decidedBy = decidedBy;
    }

    public LocalDateTime getDecidedAt() {
        return decidedAt;
    }

    public void setDecidedAt(LocalDateTime decidedAt) {
        this.decidedAt = decidedAt;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }
}
