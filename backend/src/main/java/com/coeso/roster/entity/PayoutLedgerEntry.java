package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/**
 * Append-only payout ledger row for office hours: one entry per confirmed
 * booking (expert proceeds + platform commission), and a negative reversal
 * row pointing at the entry it cancels when a payment is refunded. Statuses
 * move pending → paid once the workspace owner settles the expert out of
 * band; only unpaid (pending) entries can be reversed.
 */
@Entity
@Table(name = "payout_ledger_entries")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class PayoutLedgerEntry extends TimestampedTenantEntity {

    public enum Status { PENDING, PAID, REVERSED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "booking_id", nullable = false)
    private Long bookingId;

    @Column(name = "expert_user_id", nullable = false)
    private Long expertUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.PENDING;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(name = "platform_amount_minor", nullable = false)
    private long platformAmountMinor;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(name = "reverses_entry_id")
    private Long reversesEntryId;

    public Long getId() {
        return id;
    }

    public Long getBookingId() {
        return bookingId;
    }

    public void setBookingId(Long bookingId) {
        this.bookingId = bookingId;
    }

    public Long getExpertUserId() {
        return expertUserId;
    }

    public void setExpertUserId(Long expertUserId) {
        this.expertUserId = expertUserId;
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

    public long getPlatformAmountMinor() {
        return platformAmountMinor;
    }

    public void setPlatformAmountMinor(long platformAmountMinor) {
        this.platformAmountMinor = platformAmountMinor;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public Long getReversesEntryId() {
        return reversesEntryId;
    }

    public void setReversesEntryId(Long reversesEntryId) {
        this.reversesEntryId = reversesEntryId;
    }

    public boolean isReversal() {
        return reversesEntryId != null;
    }
}
