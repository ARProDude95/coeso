package com.coeso.roster.rep;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
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
            @RequestParam(required = false) Long skillId,
            @RequestParam(required = false) String language,
            @RequestParam(required = false) Boolean available,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return repService.list(q, verticalId, statusId, experienceId, placed,
                skillId, language, available, page, size);
    }

    /** CSV export in the import's own column set — edit in a spreadsheet,
     *  re-import as-is. Same filters as the list endpoint. */
    @GetMapping("/export")
    public ResponseEntity<String> exportCsv(
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Long verticalId,
            @RequestParam(required = false) Long statusId,
            @RequestParam(required = false) Long experienceId,
            @RequestParam(required = false) Boolean placed,
            @RequestParam(required = false) Long skillId,
            @RequestParam(required = false) String language,
            @RequestParam(required = false) Boolean available) {
        String csv = repService.exportCsv(q, verticalId, statusId, experienceId, placed,
                skillId, language, available);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"roster-export.csv\"")
                .body(csv);
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

    // -------------------------------------------------------- Phase 6 photo

    /** Upload (or replace) the rep's profile photo; type + 2 MB cap validated. */
    @PostMapping(value = "/{id}/photo", consumes = org.springframework.http.MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<RepService.PhotoResponse> uploadPhoto(
            @PathVariable Long id,
            @org.springframework.web.bind.annotation.RequestParam("file") MultipartFile file)
            throws java.io.IOException {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(repService.uploadPhoto(id, file.getContentType(), file.getBytes()));
    }

    /** The stored photo bytes (avatar images need the authenticated fetch). */
    @GetMapping("/{id}/photo")
    public ResponseEntity<byte[]> photo(@PathVariable Long id) {
        RepService.StoredPhoto photo = repService.photo(id);
        return ResponseEntity.ok()
                .contentType(org.springframework.http.MediaType.parseMediaType(photo.contentType()))
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
                .body(photo.data());
    }
}
