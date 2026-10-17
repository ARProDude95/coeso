package com.coeso.roster.performance;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.commission.CommissionMath;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.CommissionRule;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.Rep;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Commission rules scoped by (offer_id, rep_id) — workspace default
 * (null,null), per offer (offer,null), rep override (null,rep) or a specific
 * offer+rep override. Resolution picks the most specific match.
 *
 * <p>Money stays integer minor units everywhere; percent rates are basis
 * points. [PRO]-gated like the rest of Phase 7; manager+ writes, manager+ reads
 * (the performance screen shows the active terms).
 */
@Service
public class CommissionRulesService {

    public record TierInput(Long upToMinor, Integer rateBp) {
    }

    public record RuleRequest(
            Long offerId,
            Long repId,
            @NotBlank String kind,
            Integer rateBp,
            Long flatMinor,
            String currency,
            List<TierInput> tiers) {
    }

    public record RuleResponse(
            Long id,
            Long offerId,
            String offerTitle,
            Long repId,
            String repName,
            String kind,
            Integer rateBp,
            Long flatMinor,
            String currency,
            List<TierInput> tiers) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final com.coeso.roster.plan.PlanLimitService planLimits;
    private final ObjectMapper objectMapper;

    @jakarta.persistence.PersistenceContext
    private jakarta.persistence.EntityManager entityManager;

    public CommissionRulesService(ScopedQueries scoped, AuditService auditService,
                                  com.coeso.roster.plan.PlanLimitService planLimits,
                                  ObjectMapper objectMapper) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.planLimits = planLimits;
        this.objectMapper = objectMapper;
    }

    // ------------------------------------------------------------------- read

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<RuleResponse> list() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "commission rules");
        List<CommissionRule> rules = entityManager
                .createQuery("select r from CommissionRule r order by r.id asc",
                        CommissionRule.class)
                .getResultList();

        Map<Long, String> offerTitles = new HashMap<>();
        Map<Long, String> repNames = new HashMap<>();
        if (!rules.isEmpty()) {
            List<Long> offerIds = rules.stream().map(CommissionRule::getOfferId)
                    .filter(java.util.Objects::nonNull).distinct().toList();
            if (!offerIds.isEmpty()) {
                for (Object[] row : entityManager
                        .createQuery("select o.id, o.title from Offer o where o.id in :ids",
                                Object[].class)
                        .setParameter("ids", offerIds).getResultList()) {
                    offerTitles.put((Long) row[0], (String) row[1]);
                }
            }
            List<Long> repIds = rules.stream().map(CommissionRule::getRepId)
                    .filter(java.util.Objects::nonNull).distinct().toList();
            if (!repIds.isEmpty()) {
                for (Object[] row : entityManager
                        .createQuery("select r.id, r.name from Rep r where r.id in :ids",
                                Object[].class)
                        .setParameter("ids", repIds).getResultList()) {
                    repNames.put((Long) row[0], (String) row[1]);
                }
            }
        }
        List<RuleResponse> responses = new ArrayList<>();
        for (CommissionRule rule : rules) {
            responses.add(toResponse(rule, offerTitles, repNames));
        }
        return responses;
    }

    // ------------------------------------------------------------------ write

    /**
     * Create-or-replace: posting the same (offer, rep) scope replaces the
     * terms, so the UI always has one save action.
     */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RuleResponse upsert(RuleRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "commission rules");

        CommissionRule.Kind kind = parseKind(request.kind());
        // Validate scope rows live in this workspace first.
        if (request.offerId() != null) {
            scoped.require(Offer.class, request.offerId(), "Offer");
        }
        if (request.repId() != null) {
            scoped.require(Rep.class, request.repId(), "Rep");
        }
        validateTerms(kind, request);

        CommissionRule existing = findByScope(request.offerId(), request.repId());
        boolean creating = existing == null;
        CommissionRule rule = creating ? new CommissionRule() : existing;
        rule.setWorkspaceId(workspaceId);
        rule.setOfferId(request.offerId());
        rule.setRepId(request.repId());
        rule.setKind(kind);
        rule.setRateBp(kind == CommissionRule.Kind.PERCENT ? request.rateBp() : null);
        rule.setFlatMinor(kind == CommissionRule.Kind.FLAT ? request.flatMinor() : null);
        rule.setCurrency(request.currency() == null ? null
                : request.currency().trim().toUpperCase(Locale.ROOT));
        rule.setTiers(kind == CommissionRule.Kind.TIERED
                ? writeTiers(request.tiers()) : null);
        if (creating) {
            entityManager.persist(rule);
        }
        entityManager.flush();

        auditService.record(creating ? AuditLog.ACTION_CREATE : AuditLog.ACTION_UPDATE,
                "commission_rule", rule.getId(),
                Map.of("kind", rule.getKind().name(),
                        "scope", scopeLabel(rule),
                        "currency", rule.getCurrency() == null ? "" : rule.getCurrency()));
        return toResponse(rule, Map.of(), Map.of());
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public void delete(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        planLimits.assertProFeature(workspaceId, "commission rules");
        CommissionRule rule = scoped.require(CommissionRule.class, id, "Commission rule");
        long references = entityManager
                .createQuery("select count(l) from LedgerEntry l"
                        + " where l.commissionRuleId = :id", Long.class)
                .setParameter("id", id)
                .getSingleResult();
        if (references > 0) {
            throw new ConflictException("Rule is used by " + references
                    + " ledger entr(ies); earnings already recorded with these terms stay as they are");
        }
        entityManager.remove(rule);
        auditService.record(AuditLog.ACTION_DELETE, "commission_rule", id,
                Map.of("kind", rule.getKind().name(), "scope", scopeLabel(rule)));
    }

    // --------------------------------------------------------------- internal

    /** Most specific wins: (offer,rep) → (null,rep) → (offer,null) → default. */
    public Optional<CommissionRule> resolve(Long offerId, Long repId) {
        List<CommissionRule> candidates = entityManager
                .createQuery("select r from CommissionRule r where r.offerId = :offerId"
                        + " or r.repId = :repId"
                        + " or (r.offerId is null and r.repId is null)", CommissionRule.class)
                .setParameter("offerId", offerId)
                .setParameter("repId", repId)
                .getResultList();
        return candidates.stream()
                .filter(r -> matches(r, offerId, repId))
                .max(java.util.Comparator.comparingInt(r -> specificity(r, offerId, repId)));
    }

    private static boolean matches(CommissionRule rule, Long offerId, Long repId) {
        boolean offerOk = rule.getOfferId() == null
                || rule.getOfferId().equals(offerId);
        boolean repOk = rule.getRepId() == null || rule.getRepId().equals(repId);
        return offerOk && repOk;
    }

    /** Lower = more specific (0 = exact offer+rep override). */
    private static int specificity(CommissionRule rule, Long offerId, Long repId) {
        int score = 0;
        if (rule.getOfferId() != null) {
            score += 1;
        }
        if (rule.getRepId() != null) {
            score += 2;
        }
        return score;
    }

    private CommissionRule findByScope(Long offerId, Long repId) {
        // Null scopes need IS NULL — '= null' never matches in JPQL, which
        // would silently create a second default rule on every save.
        StringBuilder where = new StringBuilder("select r from CommissionRule r where ");
        if (offerId == null) {
            where.append("r.offerId is null");
        } else {
            where.append("r.offerId = :offerId");
        }
        where.append(" and ");
        if (repId == null) {
            where.append("r.repId is null");
        } else {
            where.append("r.repId = :repId");
        }
        var query = entityManager.createQuery(where.toString(), CommissionRule.class);
        if (offerId != null) {
            query.setParameter("offerId", offerId);
        }
        if (repId != null) {
            query.setParameter("repId", repId);
        }
        return query.getResultList().stream().findFirst().orElse(null);
    }

    private static CommissionRule.Kind parseKind(String raw) {
        if (raw == null) {
            throw new BadRequestException("kind must be percent, flat or tiered");
        }
        try {
            return CommissionRule.Kind.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("kind must be percent, flat or tiered");
        }
    }

    private void validateTerms(CommissionRule.Kind kind, RuleRequest request) {
        if (request.currency() == null || !request.currency().trim().matches("[A-Za-z]{3}")) {
            throw new BadRequestException(
                    "currency is required (3-letter code like USD) — earnings store minor units");
        }
        switch (kind) {
            case PERCENT -> {
                if (request.rateBp() == null || request.rateBp() < 1 || request.rateBp() > 10_000) {
                    throw new BadRequestException(
                            "percent rules need rateBp between 1 and 10000 (basis points)");
                }
            }
            case FLAT -> {
                if (request.flatMinor() == null || request.flatMinor() < 0) {
                    throw new BadRequestException(
                            "flat rules need flatMinor >= 0 (money in minor units)");
                }
            }
            case TIERED -> {
                List<TierInput> tiers = request.tiers();
                if (tiers == null || tiers.isEmpty()) {
                    throw new BadRequestException("tiered rules need at least one tier");
                }
                Long previous = 0L;
                for (int i = 0; i < tiers.size(); i++) {
                    TierInput tier = tiers.get(i);
                    if (tier == null || tier.rateBp() == null
                            || tier.rateBp() < 1 || tier.rateBp() > 10_000) {
                        throw new BadRequestException(
                                "each tier needs rateBp between 1 and 10000");
                    }
                    if (tier.upToMinor() == null) {
                        if (i != tiers.size() - 1) {
                            throw new BadRequestException(
                                    "only the last tier may have no ceiling");
                        }
                    } else {
                        if (tier.upToMinor() <= previous) {
                            throw new BadRequestException(
                                    "tier ceilings must ascend (got " + tier.upToMinor()
                                            + " after " + previous + ")");
                        }
                        previous = tier.upToMinor();
                    }
                }
            }
        }
    }

    private String writeTiers(List<TierInput> tiers) {
        try {
            List<Map<String, Object>> out = new ArrayList<>();
            for (TierInput tier : tiers) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("upToMinor", tier.upToMinor());
                row.put("rateBp", tier.rateBp());
                out.add(row);
            }
            return objectMapper.writeValueAsString(out);
        } catch (Exception e) {
            throw new BadRequestException("tiers could not be serialized");
        }
    }

    public List<CommissionMath.Tier> readTiers(CommissionRule rule) {
        if (rule.getTiers() == null || rule.getTiers().isBlank()) {
            return List.of();
        }
        try {
            var array = objectMapper.readTree(rule.getTiers());
            List<CommissionMath.Tier> tiers = new ArrayList<>();
            for (var node : array) {
                Long upTo = node.hasNonNull("upToMinor") ? node.get("upToMinor").asLong() : null;
                tiers.add(new CommissionMath.Tier(upTo, node.get("rateBp").asInt()));
            }
            return tiers;
        } catch (Exception e) {
            throw new IllegalStateException("stored tiers are not readable JSON", e);
        }
    }

    // --------------------------------------------------------------- response

    private static String scopeLabel(CommissionRule rule) {
        if (rule.getOfferId() != null && rule.getRepId() != null) {
            return "offer+rep";
        }
        if (rule.getOfferId() != null) {
            return "offer";
        }
        if (rule.getRepId() != null) {
            return "rep";
        }
        return "default";
    }

    private RuleResponse toResponse(CommissionRule rule, Map<Long, String> offerTitles,
                                    Map<Long, String> repNames) {
        List<TierInput> tiers = new ArrayList<>();
        if (rule.getKind() == CommissionRule.Kind.TIERED) {
            for (CommissionMath.Tier tier : readTiers(rule)) {
                tiers.add(new TierInput(tier.upToMinor(), tier.rateBp()));
            }
        }
        return new RuleResponse(
                rule.getId(),
                rule.getOfferId(),
                rule.getOfferId() == null ? null : offerTitles.get(rule.getOfferId()),
                rule.getRepId(),
                rule.getRepId() == null ? null : repNames.get(rule.getRepId()),
                rule.getKind().name().toLowerCase(Locale.ROOT),
                rule.getRateBp(),
                rule.getFlatMinor(),
                rule.getCurrency(),
                tiers);
    }
}