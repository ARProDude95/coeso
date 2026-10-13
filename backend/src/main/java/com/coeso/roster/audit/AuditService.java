package com.coeso.roster.audit;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.repo.Repositories.AuditLogRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Writes audit_log rows inside the caller's transaction, so an audit entry and
 * the change it describes commit or roll back together. The actor and
 * workspace come from the request-scoped TenantContext, never from the request.
 */
@Service
public class AuditService {

    private final AuditLogRepository auditLogRepository;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository auditLogRepository, ObjectMapper objectMapper) {
        this.auditLogRepository = auditLogRepository;
        this.objectMapper = objectMapper;
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
