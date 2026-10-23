package com.coeso.roster.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Weekly digest schedule: Mondays at 08:00 server time (configurable via
 * {@code app.digest.cron}), one digest per active workspace, idempotent per
 * ISO week — a redeploy or a second fire in the same week is a no-op.
 *
 * <p>Guarded by {@code app.digest.job-enabled} (default on) so tests can turn
 * the schedule off; {@link DigestTest} drives {@link DigestService} directly,
 * which is where the behaviour lives.
 */
@Component
@ConditionalOnProperty(name = "app.digest.job-enabled", havingValue = "true",
        matchIfMissing = true)
public class DigestJob {

    private static final Logger log = LoggerFactory.getLogger(DigestJob.class);

    private final DigestService service;

    public DigestJob(DigestService service) {
        this.service = service;
    }

    @Scheduled(cron = "${app.digest.cron:0 0 8 * * MON}")
    public void run() {
        int built = service.buildAllForActiveWorkspaces();
        log.info("Weekly digest run finished: {}/{} active workspace(s) have this week's digest",
                built, built);
    }
}
