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
 * Commission terms scoped by (offer_id, rep_id): workspace default (null,
 * null) → per offer → rep override → offer+rep override (most specific wins).
 * All money integer minor units; percent rates are basis points.
 */
@Entity
@Table(name = "commission_rules")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class CommissionRule extends TimestampedTenantEntity {

    public enum Kind { PERCENT, FLAT, TIERED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "offer_id")
    private Long offerId;

    @Column(name = "rep_id")
    private Long repId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Kind kind;

    /** PERCENT: basis points of revenue (2500 = 25.00%). */
    @Column(name = "rate_bp")
    private Integer rateBp;

    /** FLAT: minor units paid per revenue entry. */
    @Column(name = "flat_minor")
    private Long flatMinor;

    /** Currency code the revenue is expected in (ISO 4217, e.g. USD). */
    @Column(length = 3)
    private String currency;

    /** TIERED: JSON array [{upToMinor: number|null, rateBp: number}, …] ascending. */
    @Column
    private String tiers;

    public Long getId() {
        return id;
    }

    public Long getOfferId() {
        return offerId;
    }

    public void setOfferId(Long offerId) {
        this.offerId = offerId;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public Kind getKind() {
        return kind;
    }

    public void setKind(Kind kind) {
        this.kind = kind;
    }

    public Integer getRateBp() {
        return rateBp;
    }

    public void setRateBp(Integer rateBp) {
        this.rateBp = rateBp;
    }

    public Long getFlatMinor() {
        return flatMinor;
    }

    public void setFlatMinor(Long flatMinor) {
        this.flatMinor = flatMinor;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public String getTiers() {
        return tiers;
    }

    public void setTiers(String tiers) {
        this.tiers = tiers;
    }
}