package com.coeso.roster.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Engagement snapshot schedule: nightly at 02:30 server time (configurable via
 * {@code app.engagement.cron}), one snapshot row per active member of every
 * active workspace, idempotent per (workspace, member, day) — a redeploy or a
 * second fire on the same day is a no-op.
 *
 * <p>Guarded by {@code app.engagement.job-enabled} (default on) so tests can
 * turn the schedule off; {@link EngagementTest} drives
 * {@link EngagementService} directly, which is where the behaviour lives.
 */
@Component
@ConditionalOnProperty(name = "app.engagement.job-enabled", havingValue = "true",
        matchIfMissing = true)
public class EngagementJob {

    private static final Logger log = LoggerFactory.getLogger(EngagementJob.class);

    private final EngagementService service;

    public EngagementJob(EngagementService service) {
        this.service = service;
    }

    @Scheduled(cron = "${app.engagement.cron:0 30 2 * * *}")
    public void run() {
        int done = service.snapshotAllActiveWorkspaces();
        log.info("Engagement snapshot run finished: {}/{} active workspace(s) snapshotted",
                done, done);
    }
}
