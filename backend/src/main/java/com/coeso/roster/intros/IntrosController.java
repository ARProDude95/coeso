package com.coeso.roster.intros;

import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Smart intros endpoints; everything is workspace-scoped and the acting user
 * comes from the TenantContext, never from the body. Contact (email) is
 * only present in responses after an accepted intro request, and only for
 * the two members involved.
 */
@RestController
@RequestMapping("/api/intros")
public class IntrosController {

    private final IntrosService service;

    public IntrosController(IntrosService service) {
        this.service = service;
    }

    @GetMapping("/profile")
    public IntrosService.ProfileView myProfile() {
        return service.myProfile();
    }

    @PutMapping("/profile")
    public IntrosService.ProfileView upsertProfile(
            @RequestBody IntrosService.ProfileRequest request) {
        return service.upsertProfile(request);
    }

    /** Up to 5 suggestions, each with a one-line reason. */
    @GetMapping("/suggestions")
    public List<IntrosService.Suggestion> suggestions() {
        return service.suggestions();
    }

    /** Requests an intro to a member (max 3 pending; notification goes out). */
    @PostMapping("/requests")
    public org.springframework.http.ResponseEntity<IntrosService.RequestView> requestIntro(
            @RequestBody Map<String, Object> body) {
        Object rawTarget = body.get("targetUserId");
        Long targetUserId = rawTarget instanceof Number number ? number.longValue()
                : rawTarget instanceof String text ? Long.parseLong(text) : null;
        if (targetUserId == null) {
            throw new com.coeso.roster.common.BadRequestException("targetUserId is required");
        }
        return org.springframework.http.ResponseEntity
                .status(org.springframework.http.HttpStatus.CREATED)
                .body(service.requestIntro(targetUserId, (String) body.get("reason")));
    }

    @GetMapping("/requests/incoming")
    public List<IntrosService.RequestView> incoming() {
        return service.incoming();
    }

    @GetMapping("/requests/outgoing")
    public List<IntrosService.RequestView> outgoing() {
        return service.outgoing();
    }

    /** Target accepts: contact is revealed to the requester from now on. */
    @PostMapping("/requests/{id}/accept")
    public IntrosService.RequestView accept(@PathVariable Long id) {
        return service.accept(id);
    }

    /** Target declines: nothing is revealed; the request settles. */
    @PostMapping("/requests/{id}/decline")
    public IntrosService.RequestView decline(@PathVariable Long id) {
        return service.decline(id);
    }
}
