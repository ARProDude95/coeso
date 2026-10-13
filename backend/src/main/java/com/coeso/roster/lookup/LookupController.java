package com.coeso.roster.lookup;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Lookup endpoints. Reads are open to every member of the workspace; writes
 * require admin/owner (enforced in the service layer).
 */
@RestController
@RequestMapping("/api")
public class LookupController {

    private final LookupService lookupService;

    public LookupController(LookupService lookupService) {
        this.lookupService = lookupService;
    }

    // ---------------------------------------------------------------- verticals

    @GetMapping("/verticals")
    public List<LookupService.VerticalResponse> listVerticals() {
        return lookupService.listVerticals();
    }

    @PostMapping("/verticals")
    public ResponseEntity<LookupService.VerticalResponse> createVertical(
            @Valid @RequestBody LookupService.NamedRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(lookupService.createVertical(request));
    }

    @PutMapping("/verticals/{id}")
    public LookupService.VerticalResponse updateVertical(
            @PathVariable Long id, @Valid @RequestBody LookupService.NamedRequest request) {
        return lookupService.updateVertical(id, request);
    }

    @DeleteMapping("/verticals/{id}")
    public ResponseEntity<Void> deleteVertical(@PathVariable Long id) {
        lookupService.deleteVertical(id);
        return ResponseEntity.noContent().build();
    }

    // ----------------------------------------------------------------- statuses

    @GetMapping("/statuses")
    public List<LookupService.StatusResponse> listStatuses() {
        return lookupService.listStatuses();
    }

    @PostMapping("/statuses")
    public ResponseEntity<LookupService.StatusResponse> createStatus(
            @Valid @RequestBody LookupService.StatusRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(lookupService.createStatus(request));
    }

    @PutMapping("/statuses/{id}")
    public LookupService.StatusResponse updateStatus(
            @PathVariable Long id, @Valid @RequestBody LookupService.StatusRequest request) {
        return lookupService.updateStatus(id, request);
    }

    @DeleteMapping("/statuses/{id}")
    public ResponseEntity<Void> deleteStatus(@PathVariable Long id) {
        lookupService.deleteStatus(id);
        return ResponseEntity.noContent().build();
    }

    // ------------------------------------------------------- experience levels

    @GetMapping("/experience-levels")
    public List<LookupService.ExperienceResponse> listExperienceLevels() {
        return lookupService.listExperienceLevels();
    }

    @PostMapping("/experience-levels")
    public ResponseEntity<LookupService.ExperienceResponse> createExperienceLevel(
            @Valid @RequestBody LookupService.NamedRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(lookupService.createExperienceLevel(request));
    }

    @PutMapping("/experience-levels/{id}")
    public LookupService.ExperienceResponse updateExperienceLevel(
            @PathVariable Long id, @Valid @RequestBody LookupService.NamedRequest request) {
        return lookupService.updateExperienceLevel(id, request);
    }

    @DeleteMapping("/experience-levels/{id}")
    public ResponseEntity<Void> deleteExperienceLevel(@PathVariable Long id) {
        lookupService.deleteExperienceLevel(id);
        return ResponseEntity.noContent().build();
    }
}
