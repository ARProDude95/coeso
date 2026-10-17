package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/** A language a rep speaks (one row per language, free-form names). */
@Entity
@Table(name = "rep_languages")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class RepLanguage extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rep_id", nullable = false)
    private Long repId;

    @Column(nullable = false, length = 60)
    private String language;

    public Long getId() {
        return id;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public String getLanguage() {
        return language;
    }

    public void setLanguage(String language) {
        this.language = language;
    }
}