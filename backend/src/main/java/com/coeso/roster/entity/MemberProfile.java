package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/**
 * Per-workspace member profile for smart intros: "offering" and "looking
 * for" tag lists plus an industry. One row per (workspace, user).
 */
@Entity
@Table(name = "member_profiles")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class MemberProfile extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** What this member can give, e.g. ["go-to-market", "hiring"]. */
    @Column(name = "offering_tags", columnDefinition = "json")
    private String offeringTags;

    /** What this member wants, e.g. ["fundraising", "contract review"]. */
    @Column(name = "looking_for_tags", columnDefinition = "json")
    private String lookingForTags;

    @Column(length = 80)
    private String industry;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    /** Stored as a JSON array string; never null, "[]" at worst. */
    public String getOfferingTags() {
        return offeringTags == null ? "[]" : offeringTags;
    }

    public void setOfferingTags(String offeringTags) {
        this.offeringTags = offeringTags;
    }

    /** Stored as a JSON array string; never null, "[]" at worst. */
    public String getLookingForTags() {
        return lookingForTags == null ? "[]" : lookingForTags;
    }

    public void setLookingForTags(String lookingForTags) {
        this.lookingForTags = lookingForTags;
    }

    public String getIndustry() {
        return industry;
    }

    public void setIndustry(String industry) {
        this.industry = industry;
    }
}
