package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinColumns;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/** A skill tag an offer requires (drives the skills overlap match factor). */
@Entity
@Table(name = "offer_required_skills")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class OfferRequiredSkill extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "offer_id", nullable = false)
    private Long offerId;

    @Column(name = "tag_id", nullable = false)
    private Long tagId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "tag_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private SkillTag tag;

    public Long getId() {
        return id;
    }

    public Long getOfferId() {
        return offerId;
    }

    public void setOfferId(Long offerId) {
        this.offerId = offerId;
    }

    public Long getTagId() {
        return tagId;
    }

    public void setTagId(Long tagId) {
        this.tagId = tagId;
    }

    public SkillTag getTag() {
        return tag;
    }

    public void setTag(SkillTag tag) {
        this.tag = tag;
        this.tagId = tag == null ? null : tag.getId();
    }
}