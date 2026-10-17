package com.coeso.roster.performance;

import java.time.LocalDate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Earnings ledger [PRO]. Reads are open to every member but reps are clamped
 * server-side to their own rows (a repId they don't own is a 403). Approve is
 * manager+.
 */
@RestController
@RequestMapping("/api/earnings")
public class EarningsController {

    private final LedgerService ledgerService;

    public EarningsController(LedgerService ledgerService) {
        this.ledgerService = ledgerService;
    }

    @GetMapping
    public LedgerService.EarningsPage earnings(
            @RequestParam(required = false) Long repId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false)
            @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
            LocalDate from,
            @RequestParam(required = false)
            @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
            LocalDate to) {
        return ledgerService.earnings(new LedgerService.EarningsQuery(repId, status, from, to));
    }

    @PostMapping("/{id}/approve")
    public LedgerService.EarningsEntry approve(@PathVariable Long id) {
        return ledgerService.approve(id);
    }
}