package com.coeso.roster.common;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Loads tenant entities by id through JPQL so the workspace Hibernate filter is
 * always applied. {@code EntityManager.find} / repository {@code findById} must
 * not be used for tenant-owned rows because identifier lookups can bypass filters:
 * an id from another workspace would otherwise be loadable.
 */
@Component
public class ScopedQueries {

    @PersistenceContext
    private EntityManager entityManager;

    public <T> T find(Class<T> entityType, Long id) {
        if (id == null) {
            return null;
        }
        List<T> results = entityManager
                .createQuery("select e from " + entityType.getSimpleName() + " e where e.id = :id",
                        entityType)
                .setParameter("id", id)
                .setMaxResults(1)
                .getResultList();
        return results.isEmpty() ? null : results.get(0);
    }

    public <T> T require(Class<T> entityType, Long id, String label) {
        T entity = find(entityType, id);
        if (entity == null) {
            throw new NotFoundException(label + " " + id + " not found");
        }
        return entity;
    }

    public EntityManager em() {
        return entityManager;
    }
}
