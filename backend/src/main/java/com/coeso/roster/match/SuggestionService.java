package com.coeso.roster.match;

import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferRequiredSkill;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepLanguage;
import com.coeso.roster.entity.RepPreferredVertical;
import com.coeso.roster.entity.RepSkill;
import com.coeso.roster.performance.LeaderboardService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * "Suggested reps" for an offer: every live, currently-unplaced rep in the
 * workspace, scored 0–100 by {@link MatchScorer} against the offer's
 * requirements, ranked best-first, with the per-factor breakdown attached so
 * the UI can explain each score. One-click place then goes through the normal
 * placement endpoint and its rules — this service only ranks, it never places.
 *
 * <p>Permission matrix: manager+ (the panel exposes candidate intelligence,
 * same bar as the rest of the roster/offer API). Tenant scoping comes from the
 * Hibernate filter (offer id is loaded through {@link ScopedQueries}, so an
 * id from another workspace is a 404, not a leak).
 *
 * <p>Performance: each candidate's match score now includes the Phase 7
 * performance factor — the rep's quarter-to-date leaderboard index (see
 * {@link LeaderboardService#performanceIndex}). Reps (or workspaces) with no
 * logged activity keep the factor as not applicable, exactly as before.
 */
@Service
public class SuggestionService {

    public static final int DEFAULT_LIMIT = 10;
    public static final int MAX_LIMIT = 50;

    /** One ranked candidate with the full scoring breakdown. */
    public record Suggestion(
            Long repId,
            String repName,
            String email,
            String verticalName,
            String experienceLevelName,
            String statusName,
            Integer benchDays,
            Integer hoursPerWeek,
            String timezone,
            int score,
            List<MatchScorer.Factor> factors) {
    }

    private final ScopedQueries scoped;
    private final LeaderboardService leaderboard;

    @PersistenceContext
    private EntityManager entityManager;

    public SuggestionService(ScopedQueries scoped, LeaderboardService leaderboard) {
        this.scoped = scoped;
        this.leaderboard = leaderboard;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<Suggestion> suggest(Long offerId, Integer limit) {
        Offer offer = scoped.require(Offer.class, offerId, "Offer");
        int max = limit == null || limit <= 0 ? DEFAULT_LIMIT
                : Math.min(limit, MAX_LIMIT);

        // Live, unplaced reps only — a placed rep is not an available candidate.
        List<Rep> candidates = entityManager
                .createQuery("select r from Rep r"
                        + " left join fetch r.vertical"
                        + " left join fetch r.status"
                        + " left join fetch r.experienceLevel"
                        + " where r.deletedAt is null"
                        + " and not exists (select p from Placement p"
                        + " where p.repId = r.id and p.status = :activeStatus)"
                        + " order by r.name asc", Rep.class)
                .setParameter("activeStatus",
                        com.coeso.roster.entity.PlacementStatus.ACTIVE)
                .getResultList();
        if (candidates.isEmpty()) {
            return List.of();
        }
        List<Long> repIds = candidates.stream().map(Rep::getId).toList();

        Map<Long, Set<String>> skills = loadSkillNames(repIds);
        Map<Long, Set<String>> languages = loadLanguages(repIds);
        Map<Long, Set<Long>> preferred = loadPreferredVerticals(repIds);
        Map<Long, Integer> levelRanks = experienceLevelRanksByLevelId();
        // Phase 7 bridge: quarter-to-date leaderboard index per candidate —
        // null means "no activity logged", which leaves the factor out of the
        // denominator instead of scoring the rep zero.
        Map<Long, Double> performance = leaderboard.performanceIndex(repIds);
        Map<Long, Rep> byId = new HashMap<>();
        candidates.forEach(rep -> byId.put(rep.getId(), rep));

        MatchScorer.OfferNeeds needs = offerNeeds(offer, levelRanks);
        LocalDate referenceDate = offer.getStartDate() != null
                ? offer.getStartDate() : LocalDate.now();

        List<Suggestion> suggestions = new ArrayList<>();
        for (Rep rep : candidates) {
            Integer levelRank = rep.getExperienceLevelId() == null ? null
                    : levelRanks.get(rep.getExperienceLevelId());
            MatchScorer.Candidate candidate = new MatchScorer.Candidate(
                    rep.getId(),
                    rep.getVerticalId(),
                    preferred.getOrDefault(rep.getId(), Set.of()),
                    skills.getOrDefault(rep.getId(), Set.of()),
                    levelRank,
                    languages.getOrDefault(rep.getId(), Set.of()),
                    utcOffsetMinutes(rep.getTimezone(), referenceDate),
                    rep.getAvailableFrom(),
                    performance.get(rep.getId()));

            MatchScorer.Score score = MatchScorer.score(needs, candidate);
            suggestions.add(new Suggestion(
                    rep.getId(),
                    rep.getName(),
                    rep.getEmail(),
                    rep.getVertical() == null ? null : rep.getVertical().getName(),
                    rep.getExperienceLevel() == null ? null : rep.getExperienceLevel().getName(),
                    rep.getStatus() == null ? null : rep.getStatus().getName(),
                    benchDays(rep),
                    rep.getHoursPerWeek(),
                    rep.getTimezone(),
                    score.percent(),
                    score.factors()));
        }
        suggestions.sort(Comparator
                .comparingInt(Suggestion::score).reversed()
                .thenComparing(Suggestion::repName));
        return suggestions.size() > max ? suggestions.subList(0, max) : suggestions;
    }

    /** Builds the scorer's view of the offer's requirements. */
    private MatchScorer.OfferNeeds offerNeeds(Offer offer, Map<Long, Integer> levelRanks) {
        Set<String> requiredSkills = new LinkedHashSet<>();
        for (OfferRequiredSkill row : entityManager
                .createQuery("select s from OfferRequiredSkill s"
                        + " where s.offerId = :offerId order by s.tagId", OfferRequiredSkill.class)
                .setParameter("offerId", offer.getId())
                .getResultList()) {
            if (row.getTag() != null) {
                requiredSkills.add(row.getTag().getName());
            }
        }
        Integer requiredRank = offer.getRequiredLevelId() == null ? null
                : levelRanks.get(offer.getRequiredLevelId());
        return new MatchScorer.OfferNeeds(
                offer.getVerticalId(),
                requiredSkills,
                requiredRank,
                offer.getRequiredLanguage(),
                offer.getTzWindowStart(),
                offer.getTzWindowEnd(),
                offer.getStartDate());
    }

    /**
     * Experience-level ranks ordered by level id, i.e. the workspace's own
     * creation order — the default seed inserts Junior → Mid → Senior, so a
     * higher id means a higher rung. Assumption: workspaces add levels in
     * ascending seniority (documented in the README).
     */
    private Map<Long, Integer> experienceLevelRanksByLevelId() {
        Map<Long, Integer> ranks = new HashMap<>();
        List<ExperienceLevel> levels = entityManager
                .createQuery("select e from ExperienceLevel e order by e.id asc",
                        ExperienceLevel.class)
                .getResultList();
        for (int i = 0; i < levels.size(); i++) {
            ranks.put(levels.get(i).getId(), i);
        }
        return ranks;
    }

    private Map<Long, Set<String>> loadSkillNames(List<Long> repIds) {
        Map<Long, Set<String>> result = new HashMap<>();
        for (RepSkill row : entityManager
                .createQuery("select s from RepSkill s where s.repId in :repIds",
                        RepSkill.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            if (row.getTag() != null) {
                result.computeIfAbsent(row.getRepId(), k -> new LinkedHashSet<>())
                        .add(row.getTag().getName());
            }
        }
        return result;
    }

    private Map<Long, Set<String>> loadLanguages(List<Long> repIds) {
        Map<Long, Set<String>> result = new HashMap<>();
        for (RepLanguage row : entityManager
                .createQuery("select l from RepLanguage l where l.repId in :repIds",
                        RepLanguage.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            result.computeIfAbsent(row.getRepId(), k -> new LinkedHashSet<>())
                    .add(row.getLanguage());
        }
        return result;
    }

    private Map<Long, Set<Long>> loadPreferredVerticals(List<Long> repIds) {
        Map<Long, Set<Long>> result = new HashMap<>();
        for (RepPreferredVertical row : entityManager
                .createQuery("select v from RepPreferredVertical v"
                        + " where v.repId in :repIds", RepPreferredVertical.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            result.computeIfAbsent(row.getRepId(), k -> new LinkedHashSet<>())
                    .add(row.getVerticalId());
        }
        return result;
    }

    /** Rep's UTC offset in minutes at the reference date, or null if unset/invalid. */
    static Integer utcOffsetMinutes(String zoneId, LocalDate referenceDate) {
        if (zoneId == null || zoneId.isBlank()) {
            return null;
        }
        try {
            ZoneId zone = ZoneId.of(zoneId.trim());
            ZonedDateTime atStart = referenceDate.atStartOfDay(zone);
            return atStart.getOffset().getTotalSeconds() / 60;
        } catch (Exception e) {
            return null; // unknown zone reads as "timezone unknown" (scored 0)
        }
    }

    private static Integer benchDays(Rep rep) {
        if (rep.getJoinedDate() == null && rep.getCreatedAt() == null) {
            return null;
        }
        LocalDateTime since = rep.getCreatedAt();
        if (rep.getJoinedDate() != null) {
            since = rep.getJoinedDate().atStartOfDay();
        }
        return Math.max(0, (int) java.time.temporal.ChronoUnit.DAYS.between(
                since.toLocalDate(), LocalDate.now()));
    }
}