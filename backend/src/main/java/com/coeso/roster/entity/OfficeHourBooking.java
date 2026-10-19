package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import org.hibernate.annotations.Filter;

/**
 * A member's booking of one expert's office-hour slot. Created PENDING, only
 * the verified payment webhook moves it to CONFIRMED; the client never
 * reports success. Each status transition leaves an audit row.
 */
@Entity
@Table(name = "office_hour_bookings")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class OfficeHourBooking extends TimestampedTenantEntity {

    public enum Status {
        /** Awaiting the payment webhook. */ PENDING,
        /** Payment verified; the session can happen. */ CONFIRMED,
        /** Cancelled while unsettled (or abandoned after payment failure); no money moved. */ CANCELLED,
        /** Payment captured but a refund is underway in the provider. */ REFUND_PENDING,
        /** Payment refunded; ledger reversal recorded. */ REFUNDED
    }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "slot_id", nullable = false)
    private Long slotId;

    @Column(name = "expert_user_id", nullable = false)
    private Long expertUserId;

    @Column(name = "member_user_id", nullable = false)
    private Long memberUserId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private Status status = Status.PENDING;

    @Column(name = "price_minor", nullable = false)
    private long priceMinor;

    @Column(name = "commission_bp", nullable = false)
    private Integer commissionBp;

    @Column(name = "expert_amount_minor", nullable = false)
    private long expertAmountMinor;

    @Column(name = "platform_amount_minor", nullable = false)
    private long platformAmountMinor;

    @Column(nullable = false, length = 3)
    private String currency;

    @Column(length = 16)
    private String provider;

    @Column(name = "provider_order_id", length = 64)
    private String providerOrderId;

    @Column(name = "provider_payment_id", length = 64)
    private String providerPaymentId;

    @Column(name = "meeting_link", length = 500)
    private String meetingLink;

    @Column(name = "confirmed_at")
    private LocalDateTime confirmedAt;

    @Column(name = "cancelled_at")
    private LocalDateTime cancelledAt;

    public Long getId() {
        return id;
    }

    public Long getSlotId() {
        return slotId;
    }

    public void setSlotId(Long slotId) {
        this.slotId = slotId;
    }

    public Long getExpertUserId() {
        return expertUserId;
    }

    public void setExpertUserId(Long expertUserId) {
        this.expertUserId = expertUserId;
    }

    public Long getMemberUserId() {
        return memberUserId;
    }

    public void setMemberUserId(Long memberUserId) {
        this.memberUserId = memberUserId;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        this.status = status;
    }

    public long getPriceMinor() {
        return priceMinor;
    }

    public void setPriceMinor(long priceMinor) {
        this.priceMinor = priceMinor;
    }

    public Integer getCommissionBp() {
        return commissionBp;
    }

    public void setCommissionBp(Integer commissionBp) {
        this.commissionBp = commissionBp;
    }

    public long getExpertAmountMinor() {
        return expertAmountMinor;
    }

    public void setExpertAmountMinor(long expertAmountMinor) {
        this.expertAmountMinor = expertAmountMinor;
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

    public String getProvider() {
        return provider;
    }

    public void setProvider(String provider) {
        this.provider = provider;
    }

    public String getProviderOrderId() {
        return providerOrderId;
    }

    public void setProviderOrderId(String providerOrderId) {
        this.providerOrderId = providerOrderId;
    }

    public String getProviderPaymentId() {
        return providerPaymentId;
    }

    public void setProviderPaymentId(String providerPaymentId) {
        this.providerPaymentId = providerPaymentId;
    }

    public String getMeetingLink() {
        return meetingLink;
    }

    public void setMeetingLink(String meetingLink) {
        this.meetingLink = meetingLink;
    }

    public LocalDateTime getConfirmedAt() {
        return confirmedAt;
    }

    public void setConfirmedAt(LocalDateTime confirmedAt) {
        this.confirmedAt = confirmedAt;
    }

    public LocalDateTime getCancelledAt() {
        return cancelledAt;
    }

    public void setCancelledAt(LocalDateTime cancelledAt) {
        this.cancelledAt = cancelledAt;
    }
}
