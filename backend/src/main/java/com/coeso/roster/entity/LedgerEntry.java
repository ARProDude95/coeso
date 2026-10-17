package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import org.hibernate.annotations.Filter;

/**
 * Append-only earnings ledger row, computed from logged revenue.
 *
 * <p>Financial fields are never updated in place — the service layer offers no
 * code path that changes amount/currency/source, and corrections are new rows
 * with a negative amount whose {@code reverses_entry_id} points at the row
 * they cancel (copying its status so approvals net out). Only status
 * transitions (accrued → approved → paid) and attaching a payout are updated.
 * Paid rows can never be reversed.
 */
@Entity
@Table(name = "ledger_entries")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class LedgerEntry extends TimestampedTenantEntity {

    public enum Status { ACCRUED, APPROVED, PAID }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "placement_id", nullable = false)
    private Long placementId;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(name = "activity_entry_id", nullable = false)
    private Long activityEntryId;

    @Column(name = "commission_rule_id")
    private Long commissionRuleId;

    @Column(name = "payout_id")
    private Long payoutId;

    @Column(name = "reverses_entry_id")
    private Long reversesEntryId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.ACCRUED;

    /** Positive = owed to the rep; negative = a correcting reversal. */
    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "entered_on", nullable = false)
    private LocalDate enteredOn;

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

    public Long getActivityEntryId() {
        return activityEntryId;
    }

    public void setActivityEntryId(Long activityEntryId) {
        this.activityEntryId = activityEntryId;
    }

    public Long getCommissionRuleId() {
        return commissionRuleId;
    }

    public void setCommissionRuleId(Long commissionRuleId) {
        this.commissionRuleId = commissionRuleId;
    }

    public Long getPayoutId() {
        return payoutId;
    }

    public void setPayoutId(Long payoutId) {
        this.payoutId = payoutId;
    }

    public Long getReversesEntryId() {
        return reversesEntryId;
    }

    public void setReversesEntryId(Long reversesEntryId) {
        this.reversesEntryId = reversesEntryId;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
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

    public LocalDate getEnteredOn() {
        return enteredOn;
    }

    public void setEnteredOn(LocalDate enteredOn) {
        this.enteredOn = enteredOn;
    }

    public boolean isReversal() {
        return reversesEntryId != null;
    }
}