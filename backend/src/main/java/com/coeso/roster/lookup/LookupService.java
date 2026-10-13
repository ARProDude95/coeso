package com.coeso.roster.lookup;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.StatusKind;
import com.coeso.roster.entity.Vertical;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Per-workspace lookups: verticals, rep statuses (with fixed kind) and
 * experience levels. Listing is open to every member of the workspace; editing
 * requires admin (or owner). Deletion is blocked while rows still reference the
 * lookup.
 */
@Service
public class LookupService {

    public record NamedRequest(@NotBlank String name) {
    }

    public record StatusRequest(@NotBlank String name, @NotNull StatusKind kind) {
    }

    public record VerticalResponse(Long id, String name) {
    }

    public record StatusResponse(Long id, String name, StatusKind kind) {
    }

    public record ExperienceResponse(Long id, String name) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;

    @PersistenceContext
    private EntityManager entityManager;

    public LookupService(ScopedQueries scoped, AuditService auditService) {
        this.scoped = scoped;
        this.auditService = auditService;
    }

    // ---------------------------------------------------------------- verticals

    public List<VerticalResponse> listVerticals() {
        TenantContext.requireWorkspaceId();
        return entityManager.createQuery("select v from Vertical v order by v.id asc", Vertical.class)
                .getResultList().stream()
                .map(v -> new VerticalResponse(v.getId(), v.getName()))
                .toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public VerticalResponse createVertical(NamedRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Vertical vertical = new Vertical();
        vertical.setWorkspaceId(workspaceId);
        vertical.setName(requireName(request.name(), "Vertical"));
        entityManager.persist(vertical);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "vertical", vertical.getId(),
                Map.of("name", vertical.getName()));
        return new VerticalResponse(vertical.getId(), vertical.getName());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public VerticalResponse updateVertical(Long id, NamedRequest request) {
        TenantContext.requireWorkspaceId();
        Vertical vertical = scoped.require(Vertical.class, id, "Vertical");
        vertical.setName(requireName(request.name(), "Vertical"));
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "vertical", id, Map.of("name", vertical.getName()));
        return new VerticalResponse(vertical.getId(), vertical.getName());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void deleteVertical(Long id) {
        requireWorkspace();
        Vertical vertical = scoped.require(Vertical.class, id, "Vertical");
        long refs = countReferences(
                "select count(r) from Rep r where r.verticalId = :id"
                        + " and r.deletedAt is null", id)
                + countReferences("select count(o) from Offer o where o.verticalId = :id", id);
        if (refs > 0) {
            throw new ConflictException("Vertical is used by " + refs + " row(s); reassign them first");
        }
        entityManager.remove(vertical);
        auditService.record(AuditLog.ACTION_DELETE, "vertical", id, Map.of("name", vertical.getName()));
    }

    // ------------------------------------------------------------------ statuses

    public List<StatusResponse> listStatuses() {
        TenantContext.requireWorkspaceId();
        return entityManager.createQuery("select s from RepStatus s order by s.id asc", RepStatus.class)
                .getResultList().stream()
                .map(s -> new StatusResponse(s.getId(), s.getName(), s.getKind()))
                .toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public StatusResponse createStatus(StatusRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        RepStatus status = new RepStatus();
        status.setWorkspaceId(workspaceId);
        status.setName(requireName(request.name(), "Status"));
        status.setKind(request.kind());
        entityManager.persist(status);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "rep_status", status.getId(),
                Map.of("name", status.getName(), "kind", status.getKind().name()));
        return new StatusResponse(status.getId(), status.getName(), status.getKind());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public StatusResponse updateStatus(Long id, StatusRequest request) {
        requireWorkspace();
        RepStatus status = scoped.require(RepStatus.class, id, "Rep status");
        status.setName(requireName(request.name(), "Status"));
        status.setKind(request.kind());
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "rep_status", id,
                Map.of("name", status.getName(), "kind", status.getKind().name()));
        return new StatusResponse(status.getId(), status.getName(), status.getKind());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void deleteStatus(Long id) {
        requireWorkspace();
        RepStatus status = scoped.require(RepStatus.class, id, "Rep status");
        long refs = countReferences(
                "select count(r) from Rep r where r.statusId = :id and r.deletedAt is null", id);
        if (refs > 0) {
            throw new ConflictException("Status is used by " + refs + " rep(s); reassign them first");
        }
        entityManager.remove(status);
        auditService.record(AuditLog.ACTION_DELETE, "rep_status", id,
                Map.of("name", status.getName()));
    }

    // ---------------------------------------------------------- experience levels

    public List<ExperienceResponse> listExperienceLevels() {
        TenantContext.requireWorkspaceId();
        return entityManager
                .createQuery("select e from ExperienceLevel e order by e.id asc", ExperienceLevel.class)
                .getResultList().stream()
                .map(e -> new ExperienceResponse(e.getId(), e.getName()))
                .toList();
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public ExperienceResponse createExperienceLevel(NamedRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        ExperienceLevel level = new ExperienceLevel();
        level.setWorkspaceId(workspaceId);
        level.setName(requireName(request.name(), "Experience level"));
        entityManager.persist(level);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "experience_level", level.getId(),
                Map.of("name", level.getName()));
        return new ExperienceResponse(level.getId(), level.getName());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public ExperienceResponse updateExperienceLevel(Long id, NamedRequest request) {
        requireWorkspace();
        ExperienceLevel level = scoped.require(ExperienceLevel.class, id, "Experience level");
        level.setName(requireName(request.name(), "Experience level"));
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "experience_level", id,
                Map.of("name", level.getName()));
        return new ExperienceResponse(level.getId(), level.getName());
    }

    @PreAuthorize("@roles.hasAtLeast('ADMIN')")
    public void deleteExperienceLevel(Long id) {
        requireWorkspace();
        ExperienceLevel level = scoped.require(ExperienceLevel.class, id, "Experience level");
        long refs = countReferences(
                "select count(r) from Rep r where r.experienceLevelId = :id"
                        + " and r.deletedAt is null", id);
        if (refs > 0) {
            throw new ConflictException(
                    "Experience level is used by " + refs + " rep(s); reassign them first");
        }
        entityManager.remove(level);
        auditService.record(AuditLog.ACTION_DELETE, "experience_level", id,
                Map.of("name", level.getName()));
    }

    // ------------------------------------------------------------------- helpers

    private void requireWorkspace() {
        TenantContext.requireWorkspaceId();
    }

    private long countReferences(String jpql, Long id) {
        return entityManager.createQuery(jpql, Long.class).setParameter("id", id).getSingleResult();
    }

    private static String requireName(String raw, String label) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw new BadRequestException(label + " name is required");
        }
        return name;
    }
}
