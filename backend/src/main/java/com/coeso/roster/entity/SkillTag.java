package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/**
 * Per-workspace skill tag. Shared vocabulary: tags are created the first time
 * a rep or offer uses a name (case-insensitive reuse), so the workspace's tag
 * list grows out of real usage rather than a separate admin flow.
 */
@Entity
@Table(name = "skill_tags")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class SkillTag extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 80)
    private String name;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}