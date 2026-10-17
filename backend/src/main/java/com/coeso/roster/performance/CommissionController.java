package com.coeso.roster.performance;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Commission rules [PRO]: list, create-or-replace by scope, delete. */
@RestController
@RequestMapping("/api/commission-rules")
public class CommissionController {

    private final CommissionRulesService rules;

    public CommissionController(CommissionRulesService rules) {
        this.rules = rules;
    }

    @GetMapping
    public List<CommissionRulesService.RuleResponse> list() {
        return rules.list();
    }

    @PostMapping
    public ResponseEntity<CommissionRulesService.RuleResponse> upsert(
            @Valid @RequestBody CommissionRulesService.RuleRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(rules.upsert(request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        rules.delete(id);
        return ResponseEntity.noContent().build();
    }
}