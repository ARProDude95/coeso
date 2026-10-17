package com.coeso.roster.workspace;

import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.MetricType;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.StatusKind;
import com.coeso.roster.entity.Vertical;
import com.coeso.roster.repo.Repositories.ExperienceLevelRepository;
import com.coeso.roster.repo.Repositories.MetricTypeRepository;
import com.coeso.roster.repo.Repositories.RepStatusRepository;
import com.coeso.roster.repo.Repositories.VerticalRepository;
import java.util.List;
import org.springframework.stereotype.Service;

/**
 * Seeds the default lookups for a new workspace. Replaces the original
 * seed_workspace_defaults stored procedure, which Flyway cannot run because it
 * requires DELIMITER handling. Called once, during workspace creation.
 */
@Service
public class DefaultSeedService {

    private static final List<String> DEFAULT_VERTICALS =
            List.of("Sales", "Advertising", "Partnerships");

    private record StatusSeed(String name, StatusKind kind) {
    }

    private static final List<StatusSeed> DEFAULT_STATUSES = List.of(
            new StatusSeed("Bench", StatusKind.BENCH),
            new StatusSeed("Training", StatusKind.TRAINING),
            new StatusSeed("Inactive", StatusKind.INACTIVE));

    private static final List<String> DEFAULT_EXPERIENCE =
            List.of("Junior", "Mid", "Senior");

    private record MetricSeed(String name, MetricType.Unit unit) {
    }

    private static final List<MetricSeed> DEFAULT_METRICS = List.of(
            new MetricSeed("Calls", MetricType.Unit.COUNT),
            new MetricSeed("Meetings", MetricType.Unit.COUNT),
            new MetricSeed("Deals closed", MetricType.Unit.COUNT),
            new MetricSeed("Revenue generated", MetricType.Unit.CURRENCY));

    private final VerticalRepository verticals;
    private final RepStatusRepository statuses;
    private final ExperienceLevelRepository experienceLevels;
    private final MetricTypeRepository metricTypes;

    public DefaultSeedService(VerticalRepository verticals, RepStatusRepository statuses,
                              ExperienceLevelRepository experienceLevels,
                              MetricTypeRepository metricTypes) {
        this.verticals = verticals;
        this.statuses = statuses;
        this.experienceLevels = experienceLevels;
        this.metricTypes = metricTypes;
    }

    public void seed(Long workspaceId) {
        for (String name : DEFAULT_VERTICALS) {
            Vertical vertical = new Vertical();
            vertical.setWorkspaceId(workspaceId);
            vertical.setName(name);
            verticals.save(vertical);
        }
        for (StatusSeed seed : DEFAULT_STATUSES) {
            RepStatus status = new RepStatus();
            status.setWorkspaceId(workspaceId);
            status.setName(seed.name());
            status.setKind(seed.kind());
            statuses.save(status);
        }
        for (String name : DEFAULT_EXPERIENCE) {
            ExperienceLevel level = new ExperienceLevel();
            level.setWorkspaceId(workspaceId);
            level.setName(name);
            experienceLevels.save(level);
        }
        // Phase 7: default activity metrics (same set the migration gave
        // workspaces that existed before this phase).
        for (MetricSeed seed : DEFAULT_METRICS) {
            MetricType metric = new MetricType();
            metric.setWorkspaceId(workspaceId);
            metric.setName(seed.name());
            metric.setUnit(seed.unit());
            metricTypes.save(metric);
        }
    }
}
