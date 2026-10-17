package com.coeso.roster.audit;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.repo.Repositories.AuditLogRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * Writes audit_log rows inside the caller's transaction, so an audit entry and
 * the change it describes commit or roll back together. The actor and
 * workspace come from the request-scoped TenantContext, never from the request.
 */
@Service
public class AuditService {

    public record AuditEntry(Long id, String action, String entityType, Long entityId,
                             Long actorUserId, String actorName, String details,
                             LocalDateTime createdAt) {
    }

    public record AuditPage(int page, int size, long total, List<AuditEntry> items) {
    }

    private static final int DEFAULT_PAGE_SIZE = 25;
    private static final int MAX_PAGE_SIZE = 100;

    private final AuditLogRepository auditLogRepository;
    private final ObjectMapper objectMapper;

    @PersistenceContext
    private EntityManager entityManager;

    public AuditService(AuditLogRepository auditLogRepository, ObjectMapper objectMapper) {
        this.auditLogRepository = auditLogRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Paginated activity feed for this workspace, newest first. Actor display
     * names are resolved from the global users table (actor_user_id is not a
     * tenant FK); webhook-driven rows have no actor and read as null.
     * Manager+ — the trail names who did what, so reps must not see it.
     */
    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public AuditPage list(Integer page, Integer size) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        int pageNumber = page == null || page < 0 ? 0 : page;
        int pageSize = size == null || size <= 0
                ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);

        Long total = entityManager
                .createQuery("select count(a) from AuditLog a"
                        + " where a.workspaceId = :workspaceId", Long.class)
                .setParameter("workspaceId", workspaceId)
                .getSingleResult();

        List<AuditLog> rows = entityManager
                .createQuery("select a from AuditLog a"
                        + " where a.workspaceId = :workspaceId"
                        + " order by a.createdAt desc, a.id desc", AuditLog.class)
                .setParameter("workspaceId", workspaceId)
                .setFirstResult(pageNumber * pageSize)
                .setMaxResults(pageSize)
                .getResultList();

        // Batch-resolve actor display names (global table, no tenant filter).
        Map<Long, String> actorNames = new HashMap<>();
        List<Long> actorIds = rows.stream()
                .map(AuditLog::getActorUserId)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        if (!actorIds.isEmpty()) {
            for (Object[] row : entityManager
                    .createQuery("select u.id, u.displayName from User u where u.id in :ids",
                            Object[].class)
                    .setParameter("ids", actorIds)
                    .getResultList()) {
                actorNames.put((Long) row[0], (String) row[1]);
            }
        }

        List<AuditEntry> items = new ArrayList<>();
        for (AuditLog row : rows) {
            items.add(new AuditEntry(row.getId(), row.getAction(), row.getEntityType(),
                    row.getEntityId(), row.getActorUserId(),
                    row.getActorUserId() == null ? null : actorNames.get(row.getActorUserId()),
                    row.getDetails(), row.getCreatedAt()));
        }
        return new AuditPage(pageNumber, pageSize, total, items);
    }

    public void record(String action, String entityType, Long entityId,
                       Map<String, Object> details) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        write(workspaceId, TenantContext.actorUserId(), action, entityType, entityId, details);
    }

    /**
     * Audit row for changes made outside a user request (billing webhooks):
     * the workspace comes from the verified payload, the actor is unknown, and
     * no TenantContext is present on the provider's thread.
     */
    public void recordUnattributed(Long workspaceId, String action, String entityType,
                                   Long entityId, Map<String, Object> details) {
        write(workspaceId, null, action, entityType, entityId, details);
    }

    private void write(Long workspaceId, Long actorUserId, String action, String entityType,
                       Long entityId, Map<String, Object> details) {
        AuditLog row = new AuditLog();
        row.setWorkspaceId(workspaceId);
        row.setActorUserId(actorUserId);
        row.setAction(action);
        row.setEntityType(entityType);
        row.setEntityId(entityId);
        if (details != null && !details.isEmpty()) {
            try {
                row.setDetails(objectMapper.writeValueAsString(details));
            } catch (JsonProcessingException e) {
                row.setDetails("{\"error\":\"details serialization failed\"}");
            }
        }
        auditLogRepository.save(row);
    }
}
