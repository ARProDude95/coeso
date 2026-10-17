package com.coeso.roster.audit;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Activity feed: the audit trail the services already write, read back
 * paginated for the workspace (manager+). Newest first; actor display names
 * resolved server-side.
 */
@RestController
@RequestMapping("/api/audit")
public class AuditController {

    private final AuditService auditService;

    public AuditController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    public AuditService.AuditPage list(@RequestParam(required = false) Integer page,
                                       @RequestParam(required = false) Integer size) {
        return auditService.list(page, size);
    }
}
