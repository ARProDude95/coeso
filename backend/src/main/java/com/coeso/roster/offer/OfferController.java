package com.coeso.roster.offer;

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

    public OfferController(OfferService offerService) {
        this.offerService = offerService;
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
}
