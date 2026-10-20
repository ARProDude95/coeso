package com.coeso.roster.pods;

import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Mastermind pods endpoints. Generation and publishing are owner/admin only;
 * reading is scoped — admins see every active pod, members only the pods
 * they belong to, and pod detail / check-ins refuse non-members with 403.
 */
@RestController
@RequestMapping("/api/pods")
public class PodsController {

    public record PublishRequest(String namePrefix, List<PodsService.PodDraft> drafts) {
    }

    private final PodsService service;

    public PodsController(PodsService service) {
        this.service = service;
    }

    /** Preview the deterministic industry-adjacent grouping (admin). */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    @PostMapping("/generate")
    public List<PodsService.DraftView> generatePreview() {
        return service.generatePreview();
    }

    /**
     * Publishes pods (admin): optional manually adjusted drafts, else the
     * preview grouping. Archives the previous generation first.
     */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    @PostMapping("/publish")
    public List<PodsService.PodView> publish(@RequestBody PublishRequest request) {
        return service.publish(request.drafts(), request.namePrefix());
    }

    /** Pods the caller can see: admins all active pods, members their own. */
    @GetMapping
    public List<PodsService.PodView> myPods() {
        return service.myPods();
    }

    /** One pod's roster with per-member attendance streaks. */
    @GetMapping("/{id}")
    public PodsService.PodView pod(@PathVariable Long id) {
        return service.pod(id);
    }

    /** Files this week's check-in (wins / blockers / ask); pod members only. */
    @PostMapping("/{id}/checkins")
    public PodsService.CheckinView checkin(@PathVariable Long id,
                                           @RequestBody PodsService.CheckinRequest request) {
        return service.checkin(id, request);
    }

    /** The pod's recent check-ins, newest week first (pod members + admins). */
    @GetMapping("/{id}/checkins")
    public List<PodsService.CheckinView> recentCheckins(@PathVariable Long id) {
        return service.recentCheckins(id);
    }
}
