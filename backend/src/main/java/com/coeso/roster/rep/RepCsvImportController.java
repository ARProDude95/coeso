package com.coeso.roster.rep;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * CSV import endpoints (manager+): POST the raw CSV text with an optional
 * column mapping. Preview never writes; import writes valid rows and reports
 * skipped rows with reasons.
 */
@RestController
@RequestMapping("/api/reps/import")
public class RepCsvImportController {

    private final RepCsvImportService service;

    public RepCsvImportController(RepCsvImportService service) {
        this.service = service;
    }

    public record ImportBody(String csv, RepCsvImportService.Mapping mapping) {
    }

    @PostMapping("/preview")
    public RepCsvImportService.PreviewResult preview(@RequestBody ImportBody body) {
        return service.preview(body.csv(), body.mapping());
    }

    @PostMapping
    public ResponseEntity<RepCsvImportService.ImportResult> run(@RequestBody ImportBody body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.importRows(body.csv(),
                body.mapping()));
    }
}
