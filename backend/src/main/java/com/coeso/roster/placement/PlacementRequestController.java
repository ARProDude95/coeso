package com.coeso.roster.placement;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Placement-request endpoints. Creating is open to every member (reps may only
 * request for their own linked rep profile); approving/declining needs
 * manager+. Both are enforced in the service layer.
 */
@RestController
@RequestMapping("/api/placement-requests")
public class PlacementRequestController {

    private final PlacementRequestService service;

    public PlacementRequestController(PlacementRequestService service) {
        this.service = service;
    }

    @PostMapping
    public ResponseEntity<PlacementRequestService.RequestResponse> request(
            @RequestBody PlacementRequestService.RequestBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.request(body));
    }

    @GetMapping
    public List<PlacementRequestService.RequestResponse> list(
            @RequestParam(required = false) String status) {
        return service.list(status);
    }

    @PostMapping("/{id}/approve")
    public PlacementRequestService.RequestResponse approve(
            @PathVariable Long id,
            @RequestBody(required = false) PlacementRequestService.DecisionBody body) {
        return service.approve(id, body == null
                ? new PlacementRequestService.DecisionBody(null) : body);
    }

    @PostMapping("/{id}/decline")
    public PlacementRequestService.RequestResponse decline(
            @PathVariable Long id,
            @RequestBody(required = false) PlacementRequestService.DecisionBody body) {
        return service.decline(id, body == null
                ? new PlacementRequestService.DecisionBody(null) : body);
    }
}
