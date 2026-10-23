package com.coeso.roster.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/**
 * One column of the offer pipeline board. Stages are per workspace and ordered
 * by position, which the service keeps contiguous 1..n; offers point at exactly
 * one stage (see offers.stage_id).
 */
@Entity
@Table(name = "pipeline_stages")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class PipelineStage extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String name;

    /** 1-based column order — the board renders ascending. */
    @Column(nullable = false)
    private Integer position = 1;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getPosition() {
        return position;
    }

    public void setPosition(Integer position) {
        this.position = position;
    }
}