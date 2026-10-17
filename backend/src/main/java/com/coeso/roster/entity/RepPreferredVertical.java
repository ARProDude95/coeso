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

/** A vertical a rep prefers working in (feeds the match score's vertical factor). */
@Entity
@Table(name = "rep_preferred_verticals")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class RepPreferredVertical extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(name = "vertical_id", nullable = false)
    private Long verticalId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "vertical_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Vertical vertical;

    public Long getId() {
        return id;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public Long getVerticalId() {
        return verticalId;
    }

    public void setVerticalId(Long verticalId) {
        this.verticalId = verticalId;
    }

    public Vertical getVertical() {
        return vertical;
    }

    public void setVertical(Vertical vertical) {
        this.vertical = vertical;
        this.verticalId = vertical == null ? null : vertical.getId();
    }
}