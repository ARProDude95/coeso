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

/** Per-workspace rep status lookup with a fixed semantic kind (bench/training/inactive). */
@Entity
@Table(name = "rep_statuses")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class RepStatus extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private StatusKind kind;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public StatusKind getKind() {
        return kind;
    }

    public void setKind(StatusKind kind) {
        this.kind = kind;
    }
}
