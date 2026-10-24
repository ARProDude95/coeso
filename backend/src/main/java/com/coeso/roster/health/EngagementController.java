package com.coeso.roster.health;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Engagement health endpoints. Everything here is owner-only (the dashboard
 * names at-risk members and the nudge messages them) and [PRO] (402 on a plan
 * below Pro), enforced by the guards on each service method.
 */
@RestController
@RequestMapping("/api/engagement")
public class EngagementController {

    private final EngagementService service;

    public EngagementController(EngagementService service) {
        this.service = service;
    }

    /** The churn-risk dashboard over the latest snapshot day. */
    @GetMapping("/dashboard")
    public EngagementService.DashboardView dashboard() {
        return service.dashboard();
    }

    /** Computes and stores today's snapshots for every active member. */
    @PostMapping("/refresh")
    public List<EngagementService.SnapshotView> refresh() {
        return service.snapshotNow();
    }

    /** Sends one templated engagement nudge through the Discord seam. */
    @PostMapping("/members/{userId}/nudge")
    public EngagementService.NudgeView nudge(@PathVariable Long userId) {
        return service.nudge(userId);
    }
}
