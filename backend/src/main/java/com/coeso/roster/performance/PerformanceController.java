package com.coeso.roster.performance;

import jakarta.validation.Valid;
import java.time.LocalDate;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Performance logging endpoints [PRO]. Role rules live in the service layer
 * (manager+ bars via method security; the rep 7-day / own-rows rules are
 * enforced there with precise 403s).
 */
@RestController
@RequestMapping("/api")
public class PerformanceController {

    private final ActivityService activityService;

    public PerformanceController(ActivityService activityService) {
        this.activityService = activityService;
    }

    // ------------------------------------------------------------ metric types

    @GetMapping("/metric-types")
    public List<ActivityService.MetricResponse> listMetricTypes() {
        return activityService.listMetricTypes();
    }

    @PostMapping("/metric-types")
    public ResponseEntity<ActivityService.MetricResponse> createMetricType(
            @Valid @RequestBody ActivityService.MetricRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(activityService.createMetricType(request));
    }

    @PutMapping("/metric-types/{id}")
    public ActivityService.MetricResponse updateMetricType(
            @PathVariable Long id, @Valid @RequestBody ActivityService.MetricRequest request) {
        return activityService.updateMetricType(id, request);
    }

    @DeleteMapping("/metric-types/{id}")
    public ResponseEntity<Void> deleteMetricType(@PathVariable Long id) {
        activityService.deleteMetricType(id);
        return ResponseEntity.noContent().build();
    }

    // ----------------------------------------------------------------- entries

    /** The caller's loggable placements (reps: only their own). */
    @GetMapping("/activity/meta")
    public java.util.List<ActivityService.LogPlacement> activityMeta() {
        return activityService.logMeta();
    }

    @GetMapping("/activity")
    public ActivityService.ActivityPage listActivity(
            @RequestParam(required = false) Long placementId,
            @RequestParam(required = false) Long repId,
            @RequestParam(required = false) Long metricTypeId,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return activityService.list(placementId, repId, metricTypeId, from, to, page, size);
    }

    @PostMapping("/activity")
    public ResponseEntity<ActivityService.ActivityResponse> createActivity(
            @Valid @RequestBody ActivityService.ActivityRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(activityService.create(request));
    }

    @PutMapping("/activity/{id}")
    public ActivityService.ActivityResponse updateActivity(
            @PathVariable Long id,
            @Valid @RequestBody ActivityService.ActivityUpdateRequest request) {
        return activityService.update(id, request);
    }

    @DeleteMapping("/activity/{id}")
    public ResponseEntity<Void> deleteActivity(@PathVariable Long id) {
        activityService.delete(id);
        return ResponseEntity.noContent().build();
    }
}