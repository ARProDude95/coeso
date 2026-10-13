package com.coeso.roster.rep;

import jakarta.validation.Valid;
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

@RestController
@RequestMapping("/api/reps")
public class RepController {

    private final RepService repService;

    public RepController(RepService repService) {
        this.repService = repService;
    }

    @GetMapping
    public RepService.RepPage list(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Long verticalId,
            @RequestParam(required = false) Long statusId,
            @RequestParam(required = false) Long experienceId,
            @RequestParam(required = false) Boolean placed,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return repService.list(q, verticalId, statusId, experienceId, placed, page, size);
    }

    @PostMapping
    public ResponseEntity<RepService.RepResponse> create(
            @Valid @RequestBody RepService.RepRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(repService.create(request));
    }

    @PutMapping("/{id}")
    public RepService.RepResponse update(@PathVariable Long id,
                                         @Valid @RequestBody RepService.RepRequest request) {
        return repService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        repService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
