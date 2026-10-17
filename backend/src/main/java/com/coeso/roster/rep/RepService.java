package com.coeso.roster.rep;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepLanguage;
import com.coeso.roster.entity.RepPhoto;
import com.coeso.roster.entity.RepPreferredVertical;
import com.coeso.roster.entity.RepSkill;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.Vertical;
import com.coeso.roster.lookup.SkillTagService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Roster CRUD with tenant-scoped filters. List supports q / vertical / status /
 * experience / placed and pagination; "placed" is derived from active
 * placements, never stored on the rep.
 */
@Service
public class RepService {

    public record RepRequest(
            @NotBlank String name,
            String email,
            String discordUserId,
            Long verticalId,
            Long statusId,
            Long experienceLevelId,
            String notes,
            LocalDate joinedDate,
            // ------------------------------------------------ Phase 6 profile
            String bio,
            String timezone,
            @Min(0) @Max(168) Integer hoursPerWeek,
            LocalDate availableFrom,
            /** Skill tag names — created/reused case-insensitively. */
            List<String> skills,
            List<String> languages,
            List<Long> preferredVerticalIds) {
    }

    public record RepResponse(
            Long id,
            String name,
            String email,
            String discordUserId,
            Long verticalId,
            String verticalName,
            Long statusId,
            String statusName,
            String statusKind,
            Long experienceLevelId,
            String experienceLevelName,
            String notes,
            LocalDate joinedDate,
            boolean placed,
            Long offerId,
            String offerTitle,
            String clientName,
            /** Days since the bench clock started (last ended placement, else
             *  joined date, else row creation); null while placed. */
            Integer benchDays,
            // ------------------------------------------------ Phase 6 profile
            String bio,
            String timezone,
            Integer hoursPerWeek,
            LocalDate availableFrom,
            List<String> skills,
            List<String> languages,
            List<Long> preferredVerticalIds,
            boolean hasPhoto) {
    }

    public record RepPage(int page, int size, long total, List<RepResponse> items) {
    }

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final ScopedQueries scoped;
    private final com.coeso.roster.plan.PlanLimitService planLimits;
    private final AuditService auditService;
    private final SkillTagService skillTags;

    @PersistenceContext
    private EntityManager entityManager;

    public RepService(ScopedQueries scoped, com.coeso.roster.plan.PlanLimitService planLimits,
                      AuditService auditService, SkillTagService skillTags) {
        this.scoped = scoped;
        this.planLimits = planLimits;
        this.auditService = auditService;
        this.skillTags = skillTags;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RepPage list(String q, Long verticalId, Long statusId, Long experienceId,
                        Boolean placed, Long skillId, String language, Boolean available,
                        Integer page, Integer size) {
        Filters filters = buildFilters(q, verticalId, statusId, experienceId, placed,
                skillId, language, available);

        var countQuery = entityManager
                .createQuery("select count(r) from Rep r" + filters.where(), Long.class);
        filters.params().forEach(countQuery::setParameter);
        Long total = countQuery.getSingleResult();

        int pageNumber = page == null || page < 0 ? 0 : page;
        int pageSize = size == null || size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);

        var dataQuery = entityManager
                .createQuery("select r from Rep r"
                        + " left join fetch r.vertical"
                        + " left join fetch r.status"
                        + " left join fetch r.experienceLevel"
                        + filters.where() + " order by r.id desc", Rep.class);
        filters.params().forEach(dataQuery::setParameter);
        List<Rep> reps = dataQuery
                .setFirstResult(pageNumber * pageSize)
                .setMaxResults(pageSize)
                .getResultList();

        Map<Long, PlacementInfo> placements = loadActivePlacements(reps.stream().map(Rep::getId).toList());
        List<Long> repIds = reps.stream().map(Rep::getId).toList();
        Profile profile = loadProfiles(repIds);
        List<Long> unplacedIds = reps.stream()
                .filter(rep -> !placements.containsKey(rep.getId()))
                .map(Rep::getId).toList();
        Map<Long, LocalDateTime> benchStarts = loadBenchStarts(unplacedIds);
        List<RepResponse> items = reps.stream()
                .map(rep -> toResponse(rep, profile, placements.get(rep.getId()),
                        placements.containsKey(rep.getId())
                                ? null : benchDays(rep, benchStarts.get(rep.getId()))))
                .toList();
        return new RepPage(pageNumber, pageSize, total, items);
    }

    /**
     * CSV export in exactly the columns the CSV import recognizes (name,
     * email, discord, vertical, status, experience, notes, joined), so an
     * export can be edited in a spreadsheet and re-imported unchanged.
     * Honours the same filters as {@link #list}. Manager+ like the rest of
     * the roster API.
     */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public String exportCsv(String q, Long verticalId, Long statusId, Long experienceId,
                            Boolean placed, Long skillId, String language, Boolean available) {
        Filters filters = buildFilters(q, verticalId, statusId, experienceId, placed,
                skillId, language, available);
        var query = entityManager.createQuery(
                "select r from Rep r"
                        + " left join fetch r.vertical"
                        + " left join fetch r.status"
                        + " left join fetch r.experienceLevel"
                        + filters.where() + " order by r.name asc", Rep.class);
        filters.params().forEach(query::setParameter);
        List<Rep> reps = query.setMaxResults(MAX_EXPORT_ROWS).getResultList();

        StringBuilder csv = new StringBuilder(
                "name,email,discord,vertical,status,experience,notes,joined\r\n");
        for (Rep rep : reps) {
            csv.append(cell(rep.getName())).append(',')
                    .append(cell(rep.getEmail())).append(',')
                    .append(cell(rep.getDiscordUserId())).append(',')
                    .append(cell(nameOf(rep.getVertical()))).append(',')
                    .append(cell(nameOf(rep.getStatus()))).append(',')
                    .append(cell(nameOf(rep.getExperienceLevel()))).append(',')
                    .append(cell(rep.getNotes())).append(',')
                    .append(cell(rep.getJoinedDate() == null ? null : rep.getJoinedDate().toString()))
                    .append("\r\n");
        }
        return csv.toString();
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RepResponse create(RepRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        long currentReps = countActiveReps(workspaceId);
        planLimits.assertCanAddRep(workspaceId, currentReps);

        Rep rep = new Rep();
        rep.setWorkspaceId(workspaceId);
        apply(rep, request);
        entityManager.persist(rep);
        entityManager.flush();
        // Child rows need the generated rep id.
        applyCollections(rep, request);

        auditService.record(AuditLog.ACTION_CREATE, "rep", rep.getId(),
                Map.of("name", rep.getName()));
        return toResponse(rep, profileOf(rep.getId()), null, benchDaysFor(rep));
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RepResponse update(Long id, RepRequest request) {
        Rep rep = requireLiveRep(id);
        apply(rep, request);
        applyCollections(rep, request);
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UPDATE, "rep", rep.getId(),
                Map.of("name", rep.getName()));
        return toResponse(rep, profileOf(rep.getId()), null, benchDaysFor(rep));
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public void delete(Long id) {
        Rep rep = requireLiveRep(id);
        // A live placement would outlive the soft-deleted rep and keep its
        // seat occupied by an invisible member — unplace first.
        long activePlacements = entityManager
                .createQuery("select count(p) from Placement p"
                        + " where p.repId = :repId and p.status = :activeStatus", Long.class)
                .setParameter("repId", rep.getId())
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .getSingleResult();
        if (activePlacements > 0) {
            throw new com.coeso.roster.common.ConflictException(
                    "Rep has an active placement — unplace them before deleting");
        }
        rep.setDeletedAt(LocalDateTime.now());
        entityManager.flush();

        auditService.record(AuditLog.ACTION_DELETE, "rep", rep.getId(),
                Map.of("name", rep.getName()));
    }

    private Rep requireLiveRep(Long id) {
        Rep rep = scoped.require(Rep.class, id, "Rep");
        if (rep.getDeletedAt() != null) {
            throw new com.coeso.roster.common.NotFoundException("Rep " + id + " not found");
        }
        return rep;
    }

    private void apply(Rep rep, RepRequest request) {
        String name = request.name().trim();
        if (name.isEmpty()) {
            throw new com.coeso.roster.common.BadRequestException("Rep name is required");
        }
        rep.setName(name);
        rep.setEmail(trimToNull(request.email()));
        rep.setDiscordUserId(trimToNull(request.discordUserId()));
        rep.setNotes(request.notes());
        rep.setJoinedDate(request.joinedDate());
        rep.setBio(trimToNull(request.bio()));
        rep.setTimezone(trimToNull(request.timezone()));
        rep.setHoursPerWeek(request.hoursPerWeek());
        rep.setAvailableFrom(request.availableFrom());

        if (request.verticalId() != null) {
            Vertical vertical = scoped.require(Vertical.class, request.verticalId(), "Vertical");
            rep.setVerticalId(vertical.getId());
            rep.setVertical(vertical);
        } else {
            rep.setVerticalId(null);
            rep.setVertical(null);
        }
        if (request.statusId() != null) {
            RepStatus status = scoped.require(RepStatus.class, request.statusId(), "Rep status");
            rep.setStatusId(status.getId());
            rep.setStatus(status);
        } else {
            rep.setStatusId(null);
            rep.setStatus(null);
        }
        if (request.experienceLevelId() != null) {
            ExperienceLevel level = scoped.require(ExperienceLevel.class, request.experienceLevelId(),
                    "Experience level");
            rep.setExperienceLevelId(level.getId());
            rep.setExperienceLevel(level);
        } else {
            rep.setExperienceLevelId(null);
            rep.setExperienceLevel(null);
        }
    }

    private long countActiveReps(Long workspaceId) {
        return entityManager
                .createQuery("select count(r) from Rep r"
                        + " where r.workspaceId = :workspaceId and r.deletedAt is null", Long.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();
    }

    /** Shared list/export filter builder. Workspace scoping is unconditional. */
    private record Filters(String where, Map<String, Object> params) {
    }

    private Filters buildFilters(String q, Long verticalId, Long statusId, Long experienceId,
                                 Boolean placed, Long skillId, String language,
                                 Boolean available) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        StringBuilder where = new StringBuilder(
                " where r.workspaceId = :workspaceId and r.deletedAt is null");
        Map<String, Object> params = new HashMap<>();
        params.put("workspaceId", workspaceId);
        if (q != null && !q.isBlank()) {
            where.append(" and (lower(r.name) like :q or lower(r.email) like :q)");
            params.put("q", "%" + q.trim().toLowerCase() + "%");
        }
        if (verticalId != null) {
            where.append(" and r.verticalId = :verticalId");
            params.put("verticalId", verticalId);
        }
        if (statusId != null) {
            where.append(" and r.statusId = :statusId");
            params.put("statusId", statusId);
        }
        if (experienceId != null) {
            where.append(" and r.experienceLevelId = :experienceLevelId");
            params.put("experienceLevelId", experienceId);
        }
        if (Boolean.TRUE.equals(placed)) {
            where.append(" and exists (select p from Placement p"
                    + " where p.repId = r.id and p.status = :activeStatus)");
            params.put("activeStatus", PlacementStatus.ACTIVE);
        } else if (Boolean.FALSE.equals(placed)) {
            where.append(" and not exists (select p from Placement p"
                    + " where p.repId = r.id and p.status = :activeStatus)");
            params.put("activeStatus", PlacementStatus.ACTIVE);
        }
        if (skillId != null) {
            where.append(" and exists (select 1 from RepSkill s"
                    + " where s.repId = r.id and s.tagId = :skillId)");
            params.put("skillId", skillId);
        }
        if (language != null && !language.isBlank()) {
            where.append(" and exists (select 1 from RepLanguage l"
                    + " where l.repId = r.id and lower(l.language) = :language)");
            params.put("language", language.trim().toLowerCase(Locale.ROOT));
        }
        if (Boolean.TRUE.equals(available)) {
            where.append(" and (r.availableFrom is null or r.availableFrom <= :today)");
            params.put("today", LocalDate.now());
        } else if (Boolean.FALSE.equals(available)) {
            where.append(" and r.availableFrom is not null and r.availableFrom > :today");
            params.put("today", LocalDate.now());
        }
        return new Filters(where.toString(), params);
    }

    /** Last ENDED placement timestamp per rep (bench clock restart). */
    private Map<Long, LocalDateTime> loadBenchStarts(List<Long> repIds) {
        Map<Long, LocalDateTime> result = new HashMap<>();
        if (repIds.isEmpty()) {
            return result;
        }
        List<Object[]> rows = entityManager
                .createQuery("select p.repId, max(p.endedAt) from Placement p"
                        + " where p.repId in :repIds and p.status = :endedStatus"
                        + " group by p.repId", Object[].class)
                .setParameter("repIds", repIds)
                .setParameter("endedStatus", PlacementStatus.ENDED)
                .getResultList();
        for (Object[] row : rows) {
            result.put((Long) row[0], (LocalDateTime) row[1]);
        }
        return result;
    }

    /** Single-rep variant for create/update responses. */
    private Integer benchDaysFor(Rep rep) {
        LocalDateTime lastEnded = entityManager
                .createQuery("select max(p.endedAt) from Placement p"
                        + " where p.repId = :repId and p.status = :endedStatus",
                        LocalDateTime.class)
                .setParameter("repId", rep.getId())
                .setParameter("endedStatus", PlacementStatus.ENDED)
                .getResultList().stream().filter(java.util.Objects::nonNull).findFirst()
                .orElse(null);
        return benchDays(rep, lastEnded);
    }

    /**
     * Days on the bench for an unplaced rep: from the last ended placement if
     * they have one, else from the joined date, else from row creation.
     * Placed reps report null — their bench clock is not running.
     */
    private static Integer benchDays(Rep rep, LocalDateTime lastEndedPlacement) {
        if (lastEndedPlacement != null) {
            return (int) Math.max(0,
                    ChronoUnit.DAYS.between(lastEndedPlacement.toLocalDate(), LocalDate.now()));
        }
        if (rep.getJoinedDate() != null) {
            return (int) Math.max(0, ChronoUnit.DAYS.between(rep.getJoinedDate(), LocalDate.now()));
        }
        if (rep.getCreatedAt() != null) {
            return (int) Math.max(0,
                    ChronoUnit.DAYS.between(rep.getCreatedAt().toLocalDate(), LocalDate.now()));
        }
        return null;
    }

    private static final int MAX_EXPORT_ROWS = 10_000;

    /** RFC-4180 cell: quote when the value contains a delimiter or quotes. */
    private static String cell(String value) {
        if (value == null) {
            return "";
        }
        boolean quote = value.contains(",") || value.contains("\"")
                || value.contains("\n") || value.contains("\r");
        String escaped = value.replace("\"", "\"\"");
        return quote ? "\"" + escaped + "\"" : escaped;
    }

    private static String nameOf(Object entity) {
        if (entity instanceof Vertical v) {
            return v.getName();
        }
        if (entity instanceof RepStatus s) {
            return s.getName();
        }
        if (entity instanceof ExperienceLevel e) {
            return e.getName();
        }
        return null;
    }

    private record PlacementInfo(Long offerId, String offerTitle, String clientName) {
    }

    private Map<Long, PlacementInfo> loadActivePlacements(List<Long> repIds) {
        Map<Long, PlacementInfo> result = new HashMap<>();
        if (repIds.isEmpty()) {
            return result;
        }
        List<Object[]> rows = entityManager
                .createQuery("select p.repId, p.offerId, p.offer.title, p.offer.client.name"
                        + " from Placement p"
                        + " where p.status = :activeStatus"
                        + " and p.repId in :repIds", Object[].class)
                .setParameter("activeStatus", PlacementStatus.ACTIVE)
                .setParameter("repIds", repIds)
                .getResultList();
        for (Object[] row : rows) {
            result.put((Long) row[0], new PlacementInfo((Long) row[1], (String) row[2], (String) row[3]));
        }
        return result;
    }

    private static RepResponse toResponse(Rep rep, Profile profile, PlacementInfo placement,
                                          Integer unplacedBenchDays) {
        return new RepResponse(
                rep.getId(),
                rep.getName(),
                rep.getEmail(),
                rep.getDiscordUserId(),
                rep.getVerticalId(),
                rep.getVertical() == null ? null : rep.getVertical().getName(),
                rep.getStatusId(),
                rep.getStatus() == null ? null : rep.getStatus().getName(),
                rep.getStatus() == null ? null : rep.getStatus().getKind().name(),
                rep.getExperienceLevelId(),
                rep.getExperienceLevel() == null ? null : rep.getExperienceLevel().getName(),
                rep.getNotes(),
                rep.getJoinedDate(),
                placement != null,
                placement == null ? null : placement.offerId(),
                placement == null ? null : placement.offerTitle(),
                placement == null ? null : placement.clientName(),
                placement == null ? unplacedBenchDays : null,
                rep.getBio(),
                rep.getTimezone(),
                rep.getHoursPerWeek(),
                rep.getAvailableFrom(),
                profile.skills(rep.getId()),
                profile.languages(rep.getId()),
                profile.preferredVerticalIds(rep.getId()),
                profile.hasPhoto(rep.getId()));
    }

    // ------------------------------------------------------ Phase 6 profile

    /** Batch-loaded profile collections for a page (or one) of reps. */
    private record Profile(Map<Long, List<String>> skills,
                           Map<Long, List<String>> languages,
                           Map<Long, List<Long>> preferred,
                           Set<Long> photoIds) {

        List<String> skills(Long repId) {
            return skills.getOrDefault(repId, List.of());
        }

        List<String> languages(Long repId) {
            return returnList(languages.get(repId));
        }

        List<Long> preferredVerticalIds(Long repId) {
            return returnList(preferred.get(repId));
        }

        boolean hasPhoto(Long repId) {
            return photoIds.contains(repId);
        }

        private static <T> List<T> returnList(List<T> value) {
            return value == null ? List.of() : value;
        }
    }

    private Profile profileOf(Long repId) {
        return loadProfiles(List.of(repId));
    }

    /** Languages and skills come back insertion-ordered by name for stable UI. */
    private Profile loadProfiles(List<Long> repIds) {
        Map<Long, List<String>> skills = new HashMap<>();
        Map<Long, List<String>> languages = new HashMap<>();
        Map<Long, List<Long>> preferred = new HashMap<>();
        Set<Long> photoIds = new LinkedHashSet<>();
        if (repIds.isEmpty()) {
            return new Profile(skills, languages, preferred, photoIds);
        }
        for (RepSkill row : entityManager
                .createQuery("select s from RepSkill s where s.repId in :repIds",
                        RepSkill.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            if (row.getTag() != null) {
                skills.computeIfAbsent(row.getRepId(), k -> new ArrayList<>())
                        .add(row.getTag().getName());
            }
        }
        for (RepLanguage row : entityManager
                .createQuery("select l from RepLanguage l where l.repId in :repIds"
                        + " order by l.language asc", RepLanguage.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            languages.computeIfAbsent(row.getRepId(), k -> new ArrayList<>())
                    .add(row.getLanguage());
        }
        for (RepPreferredVertical row : entityManager
                .createQuery("select v from RepPreferredVertical v"
                        + " where v.repId in :repIds order by v.verticalId",
                        RepPreferredVertical.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            preferred.computeIfAbsent(row.getRepId(), k -> new ArrayList<>())
                    .add(row.getVerticalId());
        }
        for (Long photoRepId : entityManager
                .createQuery("select p.repId from RepPhoto p where p.repId in :repIds",
                        Long.class)
                .setParameter("repIds", repIds)
                .getResultList()) {
            photoIds.add(photoRepId);
        }
        return new Profile(skills, languages, preferred, photoIds);
    }

    /**
     * Replaces the rep's skills / languages / preferred verticals with the
     * request's lists (full-replace, like every other RepRequest field). Skill
     * tags are reused case-insensitively and created — audited — on first use.
     */
    private void applyCollections(Rep rep, RepRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();

        for (RepSkill row : entityManager
                .createQuery("select s from RepSkill s where s.repId = :repId",
                        RepSkill.class)
                .setParameter("repId", rep.getId())
                .getResultList()) {
            entityManager.remove(row);
        }
        // Executes the deletes now: Hibernate would otherwise insert the
        // replacement rows first and hit the (workspace, rep, tag) unique key.
        entityManager.flush();
        Set<String> seenSkills = new LinkedHashSet<>();
        for (String raw : nullSafe(request.skills())) {
            String key = raw.trim().toLowerCase(Locale.ROOT);
            if (key.isEmpty() || !seenSkills.add(key)) {
                continue;
            }
            var tag = skillTags.findOrCreate(raw);
            if (tag == null) {
                continue;
            }
            RepSkill row = new RepSkill();
            row.setWorkspaceId(workspaceId);
            row.setRepId(rep.getId());
            row.setTag(tag);
            entityManager.persist(row);
        }

        for (RepLanguage row : entityManager
                .createQuery("select l from RepLanguage l where l.repId = :repId",
                        RepLanguage.class)
                .setParameter("repId", rep.getId())
                .getResultList()) {
            entityManager.remove(row);
        }
        entityManager.flush();
        Set<String> seenLanguages = new LinkedHashSet<>();
        for (String raw : nullSafe(request.languages())) {
            String value = raw.trim();
            if (value.isEmpty()
                    || !seenLanguages.add(value.toLowerCase(Locale.ROOT))) {
                continue;
            }
            RepLanguage row = new RepLanguage();
            row.setWorkspaceId(workspaceId);
            row.setRepId(rep.getId());
            row.setLanguage(value);
            entityManager.persist(row);
        }

        for (RepPreferredVertical row : entityManager
                .createQuery("select v from RepPreferredVertical v where v.repId = :repId",
                        RepPreferredVertical.class)
                .setParameter("repId", rep.getId())
                .getResultList()) {
            entityManager.remove(row);
        }
        entityManager.flush();
        Set<Long> seenVerticals = new LinkedHashSet<>();
        for (Long verticalId : nullSafe(request.preferredVerticalIds())) {
            if (verticalId == null || !seenVerticals.add(verticalId)) {
                continue;
            }
            Vertical vertical = scoped.require(Vertical.class, verticalId, "Vertical");
            RepPreferredVertical row = new RepPreferredVertical();
            row.setWorkspaceId(workspaceId);
            row.setRepId(rep.getId());
            row.setVertical(vertical);
            entityManager.persist(row);
        }
    }

    // ------------------------------------------------------------ profile photo

    public static final int MAX_PHOTO_BYTES = 2 * 1024 * 1024;

    private static final Set<String> PHOTO_TYPES = Set.of(
            "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif");

    public record PhotoResponse(String photoUrl, String contentType, int sizeBytes) {
    }

    public record StoredPhoto(String contentType, byte[] data) {
    }

    /** Uploads (replaces) the rep's profile photo; validates type and size. */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public PhotoResponse uploadPhoto(Long id, String contentType, byte[] data) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Rep rep = requireLiveRep(id);
        if (data == null || data.length == 0) {
            throw new com.coeso.roster.common.BadRequestException("Photo file is empty");
        }
        if (data.length > MAX_PHOTO_BYTES) {
            throw new com.coeso.roster.common.BadRequestException(
                    "Photo must be 2 MB or smaller (got " + data.length + " bytes)");
        }
        String normalized = contentType == null ? ""
                : contentType.split(";")[0].trim().toLowerCase(Locale.ROOT);
        if (!PHOTO_TYPES.contains(normalized)) {
            throw new com.coeso.roster.common.BadRequestException(
                    "Photo must be a PNG, JPEG, WebP or GIF image");
        }
        RepPhoto photo = entityManager
                .createQuery("select p from RepPhoto p where p.repId = :repId",
                        RepPhoto.class)
                .setParameter("repId", rep.getId())
                .getResultList().stream().findFirst().orElse(null);
        boolean creating = photo == null;
        if (creating) {
            photo = new RepPhoto();
            photo.setWorkspaceId(workspaceId);
            photo.setRepId(rep.getId());
        }
        photo.setContentType(normalized);
        photo.setSizeBytes(data.length);
        photo.setData(data);
        if (creating) {
            entityManager.persist(photo);
        }
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UPDATE, "rep", rep.getId(),
                Map.of("name", rep.getName(), "photo", normalized));
        return new PhotoResponse("/api/reps/" + rep.getId() + "/photo",
                normalized, data.length);
    }

    /** Stored photo bytes for the card avatar; 404 when none was uploaded. */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public StoredPhoto photo(Long id) {
        requireLiveRep(id);
        RepPhoto photo = entityManager
                .createQuery("select p from RepPhoto p where p.repId = :repId",
                        RepPhoto.class)
                .setParameter("repId", id)
                .getResultList().stream().findFirst()
                .orElseThrow(() -> new com.coeso.roster.common.NotFoundException(
                        "Rep " + id + " photo not found"));
        return new StoredPhoto(photo.getContentType(), photo.getData());
    }

    private static <T> List<T> nullSafe(List<T> values) {
        return values == null ? List.of() : values;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
