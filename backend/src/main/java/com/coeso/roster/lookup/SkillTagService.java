package com.coeso.roster.lookup;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.SkillTag;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The workspace's skill-tag vocabulary. Tags are created lazily the first time
 * a rep or offer mentions a name (case-insensitive reuse — "Cold calling" and
 * "cold calling" are one tag), so the list grows out of real usage. Every tag
 * creation is audited like any other create.
 */
@Service
public class SkillTagService {

    @PersistenceContext
    private EntityManager entityManager;

    private final AuditService auditService;

    public SkillTagService(AuditService auditService) {
        this.auditService = auditService;
    }

    /** All tags of this workspace, alphabetical — the roster/offer skill picker. */
    public List<SkillTag> listAll() {
        TenantContext.requireWorkspaceId();
        return entityManager
                .createQuery("select t from SkillTag t order by t.name asc", SkillTag.class)
                .getResultList();
    }

    /** Finds the tag by case-insensitive name or creates (and audits) it. */
    public SkillTag findOrCreate(String rawName) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty()) {
            return null;
        }
        SkillTag existing = entityManager
                .createQuery("select t from SkillTag t"
                        + " where t.workspaceId = :ws and lower(t.name) = :key",
                        SkillTag.class)
                .setParameter("ws", workspaceId)
                .setParameter("key", name.toLowerCase(Locale.ROOT))
                .getResultList().stream().findFirst().orElse(null);
        if (existing != null) {
            return existing;
        }
        SkillTag tag = new SkillTag();
        tag.setWorkspaceId(workspaceId);
        tag.setName(name);
        entityManager.persist(tag);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "skill_tag", tag.getId(),
                Map.of("name", tag.getName()));
        return tag;
    }
}