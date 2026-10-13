package com.coeso.roster.rep;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.Vertical;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.constraints.NotBlank;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
            LocalDate joinedDate) {
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
            String clientName) {
    }

    public record RepPage(int page, int size, long total, List<RepResponse> items) {
    }

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final ScopedQueries scoped;
    private final com.coeso.roster.plan.PlanLimitService planLimits;
    private final AuditService auditService;

    @PersistenceContext
    private EntityManager entityManager;

    public RepService(ScopedQueries scoped, com.coeso.roster.plan.PlanLimitService planLimits,
                      AuditService auditService) {
        this.scoped = scoped;
        this.planLimits = planLimits;
        this.auditService = auditService;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RepPage list(String q, Long verticalId, Long statusId, Long experienceId,
                        Boolean placed, Integer page, Integer size) {
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

        var countQuery = entityManager
                .createQuery("select count(r) from Rep r" + where, Long.class);
        params.forEach(countQuery::setParameter);
        Long total = countQuery.getSingleResult();

        int pageNumber = page == null || page < 0 ? 0 : page;
        int pageSize = size == null || size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);

        var dataQuery = entityManager
                .createQuery("select r from Rep r"
                        + " left join fetch r.vertical"
                        + " left join fetch r.status"
                        + " left join fetch r.experienceLevel"
                        + where + " order by r.id desc", Rep.class);
        params.forEach(dataQuery::setParameter);
        List<Rep> reps = dataQuery
                .setFirstResult(pageNumber * pageSize)
                .setMaxResults(pageSize)
                .getResultList();

        Map<Long, PlacementInfo> placements = loadActivePlacements(reps.stream().map(Rep::getId).toList());
        List<RepResponse> items = reps.stream().map(rep -> toResponse(rep, placements.get(rep.getId()))).toList();
        return new RepPage(pageNumber, pageSize, total, items);
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

        auditService.record(AuditLog.ACTION_CREATE, "rep", rep.getId(),
                Map.of("name", rep.getName()));
        return toResponse(rep, null);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public RepResponse update(Long id, RepRequest request) {
        Rep rep = requireLiveRep(id);
        apply(rep, request);
        entityManager.flush();

        auditService.record(AuditLog.ACTION_UPDATE, "rep", rep.getId(),
                Map.of("name", rep.getName()));
        return toResponse(rep, null);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public void delete(Long id) {
        Rep rep = requireLiveRep(id);
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

    private static RepResponse toResponse(Rep rep, PlacementInfo placement) {
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
                placement == null ? null : placement.clientName());
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
