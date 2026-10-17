package com.coeso.roster.offer;

import com.coeso.roster.match.SuggestionService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/offers")
public class OfferController {

    private final OfferService offerService;
    private final SuggestionService suggestionService;

    public OfferController(OfferService offerService, SuggestionService suggestionService) {
        this.offerService = offerService;
        this.suggestionService = suggestionService;
    }

    @GetMapping
    public List<OfferService.OfferResponse> list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Long verticalId,
            @RequestParam(required = false) String effectiveStatus) {
        return offerService.list(q, verticalId, effectiveStatus);
    }

    @PostMapping
    public ResponseEntity<OfferService.OfferResponse> create(
            @Valid @RequestBody OfferService.OfferRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(offerService.create(request));
    }

    @PutMapping("/{id}")
    public OfferService.OfferResponse update(@PathVariable Long id,
                                             @Valid @RequestBody OfferService.OfferRequest request) {
        return offerService.update(id, request);
    }

    @PostMapping("/{id}/close")
    public OfferService.OfferResponse close(@PathVariable Long id) {
        return offerService.close(id);
    }

    /**
     * "Suggested reps": available reps ranked 0–100 against this offer's
     * requirements with the per-factor breakdown. Manager+ (service-guarded);
     * placing still goes through POST /api/placements and its rules.
     */
    @GetMapping("/{id}/suggested")
    public List<SuggestionService.Suggestion> suggested(
            @PathVariable Long id,
            @RequestParam(required = false) Integer limit) {
        return suggestionService.suggest(id, limit);
    }
}
