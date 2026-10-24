package com.coeso.roster.health;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Weekly digest endpoints. Reads are admin+ (the digest names every member's
 * activity, so it sits with the other management summaries); building is also
 * admin+ and idempotent — the same-week second call returns the stored row.
 * Both are [PRO]: a plan below Pro answers 402 PRO_FEATURE_REQUIRED.
 */
@RestController
@RequestMapping("/api/digest")
public class DigestController {

    private final DigestService service;

    public DigestController(DigestService service) {
        this.service = service;
    }

    /** The workspace's most recent stored digest (404 before the first build). */
    @GetMapping
    public DigestService.DigestView latest() {
        return service.latest();
    }

    /** Builds this week's digest if missing and returns it. */
    @PostMapping("/build")
    public DigestService.DigestView build() {
        return service.buildNow();
    }
}
