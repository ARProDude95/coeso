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
 * Per-workspace metric vocabulary for activity logging. Values are stored as
 * integers either way: {@code COUNT} entries hold plain counts, {@code CURRENCY}
 * entries hold money in minor units plus the commission rule's currency.
 */
@Entity
@Table(name = "metric_types")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class MetricType extends TimestampedTenantEntity {

    public enum Unit { COUNT, CURRENCY }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Unit unit = Unit.COUNT;

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Unit getUnit() {
        return unit;
    }

    public void setUnit(Unit unit) {
        this.unit = unit;
    }
}