package com.coeso.roster.placement;

import jakarta.validation.Valid;
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

@RestController
@RequestMapping("/api/placements")
public class PlacementController {

    private final PlacementService placementService;

    public PlacementController(PlacementService placementService) {
        this.placementService = placementService;
    }

    @PostMapping
    public ResponseEntity<PlacementService.PlacementResponse> place(
            @Valid @RequestBody PlacementService.PlaceRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(placementService.place(request));
    }

    @PostMapping("/{id}/end")
    public PlacementService.PlacementResponse end(@PathVariable Long id,
                                                  @RequestBody(required = false)
                                                  PlacementService.EndRequest request) {
        return placementService.end(id, request == null ? new PlacementService.EndRequest(null) : request);
    }

    @GetMapping
    public List<PlacementService.PlacementResponse> list(
            @RequestParam(required = false) Long offerId,
            @RequestParam(required = false) Long repId) {
        return placementService.list(offerId, repId);
    }
}
