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
 * A payout: a manager's record that a batch of approved ledger entries was
 * paid (no real money moves). Ledger rows point here via payout_id and flip to
 * 'paid' when the payout is created.
 */
@Entity
@Table(name = "payouts")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class Payout extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "entry_count", nullable = false)
    private int entryCount;

    @Column(name = "paid_on", nullable = false)
    private LocalDate paidOn;

    @Column(name = "reference_note", length = 255)
    private String referenceNote;

    @Column(name = "created_by")
    private Long createdBy;

    public Long getId() {
        return id;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public long getAmountMinor() {
        return amountMinor;
    }

    public void setAmountMinor(long amountMinor) {
        this.amountMinor = amountMinor;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public int getEntryCount() {
        return entryCount;
    }

    public void setEntryCount(int entryCount) {
        this.entryCount = entryCount;
    }

    public LocalDate getPaidOn() {
        return paidOn;
    }

    public void setPaidOn(LocalDate paidOn) {
        this.paidOn = paidOn;
    }

    public String getReferenceNote() {
        return referenceNote;
    }

    public void setReferenceNote(String referenceNote) {
        this.referenceNote = referenceNote;
    }

    public Long getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(Long createdBy) {
        this.createdBy = createdBy;
    }
}