package com.coeso.roster.performance;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Payout records [PRO]: manager+ create/list plus CSV export. */
@RestController
@RequestMapping("/api/payouts")
public class PayoutController {

    private final PayoutService payoutService;

    public PayoutController(PayoutService payoutService) {
        this.payoutService = payoutService;
    }

    @GetMapping
    public List<PayoutService.PayoutResponse> list() {
        return payoutService.list();
    }

    @PostMapping
    public ResponseEntity<PayoutService.PayoutResponse> create(
            @Valid @RequestBody PayoutService.PayoutRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(payoutService.create(request));
    }

    @GetMapping("/export")
    public ResponseEntity<String> exportCsv() {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .header("Content-Disposition",
                        "attachment; filename=\"payout-export.csv\"")
                .body(payoutService.exportCsv());
    }
}