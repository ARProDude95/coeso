package com.coeso.roster.pipeline;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.PipelineStage;
import com.coeso.roster.offer.OfferService;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * The offer pipeline's configurable board columns [Phase 8].
 *
 * <ul>
 *   <li>Reading stages is open to every member (same bar as the other
 *       lookups); renaming, reordering and deleting need admin/owner.</li>
 *   <li>Positions stay contiguous 1..n after every write, so the board's
 *       column order is always the list order.</li>
 *   <li>A stage can only be deleted while it is empty, and a workspace always
 *       keeps at least one column — offers are never orphaned.</li>
 *   <li>The board itself (offers grouped by stage) follows the offers bar:
 *       manager and up.</li>
 * </ul>
 */
@Service
public class PipelineService {

    public record StageRequest(
            @NotBlank @Size(max = 60) String name) {
    }

    public record DirectionRequest(@NotNull String direction) {
    }

    public record StageResponse(Long id, String name, Integer position) {
    }

    /** One board column with the offers sitting in it. */
    public record BoardResponse(StageResponse stage, List<OfferService.OfferResponse> offers) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;
    private final OfferService offerService;

    @PersistenceContext
    private EntityManager entityManager;

    public PipelineService(ScopedQueries scoped, AuditService auditService,
                           OfferService offerService) {
        this.scoped = scoped;
        this.auditService = auditService;
        this.offerService = offerService;
    }

    // ------------------------------------------------------------------ stages

    /** Read is open to every member of the workspace. */
    public List<StageResponse> list() {
        return stages().stream().map(PipelineService::toResponse).toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public StageResponse create(StageRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        String name = requireName(request.name());
        assertUniqueName(name, null);

        PipelineStage stage = new PipelineStage();
        stage.setWorkspaceId(workspaceId);
        stage.setName(name);
        stage.setPosition(maxPosition(workspaceId) + 1);
        entityManager.persist(stage);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "pipeline_stage", stage.getId(),
                Map.of("name", stage.getName(), "position", stage.getPosition()));
        return toResponse(stage);
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public StageResponse rename(Long id, StageRequest request) {
        TenantContext.requireWorkspaceId();
        PipelineStage stage = scoped.require(PipelineStage.class, id, "Stage");
        String name = requireName(request.name());
        assertUniqueName(name, stage.getId());
        stage.setName(name);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "pipeline_stage", stage.getId(),
                Map.of("name", stage.getName()));
        return toResponse(stage);
    }

    /**
     * Swaps a column with its neighbour ("UP" / "DOWN"). Moving past either
     * end is a no-op — the response still reflects the stored order.
     */
    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public List<StageResponse> move(Long id, DirectionRequest request) {
        TenantContext.requireWorkspaceId();
        List<PipelineStage> ordered = stages();
        String direction = request.direction() == null
                ? "" : request.direction().trim().toUpperCase(Locale.ROOT);
        if (!direction.equals("UP") && !direction.equals("DOWN")) {
            throw new BadRequestException("direction must be UP or DOWN");
        }
        int index = indexOf(ordered, id);
        int swapWith = direction.equals("UP") ? index - 1 : index + 1;
        if (swapWith >= 0 && swapWith < ordered.size()) {
            PipelineStage current = ordered.get(index);
            // Swap in the list, then renormalize positions against the NEW
            // list order (renormalizing the old order would undo the swap).
            // Duplicate positions can occur transiently during the flush, so
            // there is deliberately no unique key on (workspace, position).
            java.util.Collections.swap(ordered, index, swapWith);
            renormalize(ordered);
            entityManager.flush();
            auditService.record(AuditLog.ACTION_UPDATE, "pipeline_stage", current.getId(),
                    Map.of("name", current.getName(), "position", current.getPosition()));
        }
        return stages().stream().map(PipelineService::toResponse).toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void delete(Long id) {
        TenantContext.requireWorkspaceId();
        List<PipelineStage> ordered = stages();
        int index = indexOf(ordered, id);
        PipelineStage stage = ordered.get(index);
        if (ordered.size() == 1) {
            throw new ConflictException("A workspace needs at least one pipeline stage");
        }
        long holders = entityManager
                .createQuery("select count(o) from Offer o where o.stageId = :stageId",
                        Long.class)
                .setParameter("stageId", stage.getId())
                .getSingleResult();
        if (holders > 0) {
            throw new ConflictException("Stage is used by " + holders
                    + " offer(s); move them before deleting it");
        }
        String name = stage.getName();
        entityManager.remove(stage);
        ordered.remove(index);
        renormalize(ordered);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_DELETE, "pipeline_stage", id, Map.of("name", name));
    }

    // ------------------------------------------------------------------- board

    /** The kanban board: every column, in order, with its offers inside. */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<BoardResponse> board() {
        List<PipelineStage> ordered = stages();
        List<OfferService.OfferResponse> offers = offerService.list(null, null, null);

        // Offers whose column exists get bucketed normally; stageless (or
        // orphaned) ones are collected separately and rendered in the first
        // column so they never disappear from the board.
        java.util.Set<Long> knownStages = new java.util.HashSet<>();
        for (PipelineStage stage : ordered) {
            knownStages.add(stage.getId());
        }
        Map<Long, List<OfferService.OfferResponse>> buckets = new HashMap<>();
        List<OfferService.OfferResponse> unassigned = new ArrayList<>();
        for (OfferService.OfferResponse offer : offers) {
            if (offer.stageId() == null || !knownStages.contains(offer.stageId())) {
                unassigned.add(offer);
            } else {
                buckets.computeIfAbsent(offer.stageId(), k -> new ArrayList<>()).add(offer);
            }
        }

        List<BoardResponse> columns = new ArrayList<>(ordered.size());
        for (int i = 0; i < ordered.size(); i++) {
            PipelineStage stage = ordered.get(i);
            List<OfferService.OfferResponse> bucket = i == 0
                    ? new ArrayList<>(unassigned)
                    : new ArrayList<>();
            bucket.addAll(buckets.getOrDefault(stage.getId(), List.of()));
            columns.add(new BoardResponse(toResponse(stage), bucket));
        }
        return columns;
    }

    // ------------------------------------------------------------------ helpers

    private List<PipelineStage> stages() {
        Long workspaceId = TenantContext.requireWorkspaceId();
        return new ArrayList<>(entityManager
                .createQuery("select s from PipelineStage s"
                        + " where s.workspaceId = :workspaceId"
                        + " order by s.position asc, s.id asc", PipelineStage.class)
                .setParameter("workspaceId", workspaceId)
                .getResultList());
    }

    private int indexOf(List<PipelineStage> ordered, Long id) {
        for (int i = 0; i < ordered.size(); i++) {
            if (ordered.get(i).getId().equals(id)) {
                return i;
            }
        }
        // scoped.require would answer 404 for a foreign stage too; keep one
        // behaviour for "no such stage in this workspace".
        throw new com.coeso.roster.common.NotFoundException("Stage " + id + " not found");
    }

    private void renormalize(List<PipelineStage> ordered) {
        for (int i = 0; i < ordered.size(); i++) {
            ordered.get(i).setPosition(i + 1);
        }
    }

    private int maxPosition(Long workspaceId) {
        Integer max = entityManager
                .createQuery("select max(s.position) from PipelineStage s"
                        + " where s.workspaceId = :workspaceId", Integer.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();
        return max == null ? 0 : max;
    }

    private void assertUniqueName(String name, Long excludeId) {
        StringBuilder jpql = new StringBuilder("select count(s) from PipelineStage s"
                + " where lower(s.name) = :name");
        if (excludeId != null) {
            jpql.append(" and s.id <> :excludeId");
        }
        var query = entityManager.createQuery(jpql.toString(), Long.class)
                .setParameter("name", name.toLowerCase(Locale.ROOT));
        if (excludeId != null) {
            query.setParameter("excludeId", excludeId);
        }
        if (query.getSingleResult() > 0) {
            throw new ConflictException("A pipeline stage named '" + name + "' already exists");
        }
    }

    private String requireName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw new BadRequestException("Stage name is required");
        }
        if (name.length() > 60) {
            throw new BadRequestException("Stage name must be at most 60 characters");
        }
        return name;
    }

    private static StageResponse toResponse(PipelineStage stage) {
        return new StageResponse(stage.getId(), stage.getName(), stage.getPosition());
    }
}