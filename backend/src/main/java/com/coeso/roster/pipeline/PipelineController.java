package com.coeso.roster.pipeline;

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
 * Offer-pipeline endpoints [Phase 8]. Reads: stages open to every member,
 * the board itself manager+ (offers data); stage writes admin/owner — all
 * enforced in the service layer. The per-offer move lives on the offer
 * controller (POST /api/offers/{id}/stage).
 */
@RestController
@RequestMapping("/api/pipeline")
public class PipelineController {

    private final PipelineService pipelineService;

    public PipelineController(PipelineService pipelineService) {
        this.pipelineService = pipelineService;
    }

    @GetMapping("/stages")
    public List<PipelineService.StageResponse> listStages() {
        return pipelineService.list();
    }

    @PostMapping("/stages")
    public ResponseEntity<PipelineService.StageResponse> createStage(
            @Valid @RequestBody PipelineService.StageRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(pipelineService.create(request));
    }

    @PutMapping("/stages/{id}")
    public PipelineService.StageResponse renameStage(
            @PathVariable Long id, @Valid @RequestBody PipelineService.StageRequest request) {
        return pipelineService.rename(id, request);
    }

    /** Reorders a column: {"direction": "UP" | "DOWN"} → the new order. */
    @PostMapping("/stages/{id}/move")
    public List<PipelineService.StageResponse> moveStage(
            @PathVariable Long id,
            @Valid @RequestBody PipelineService.DirectionRequest request) {
        return pipelineService.move(id, request);
    }

    @DeleteMapping("/stages/{id}")
    public ResponseEntity<Void> deleteStage(@PathVariable Long id) {
        pipelineService.delete(id);
        return ResponseEntity.noContent().build();
    }

    /** The kanban board: columns in order, each with the offers inside. */
    @GetMapping("/board")
    public List<PipelineService.BoardResponse> board() {
        return pipelineService.board();
    }
}