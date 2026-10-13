package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.Rep;
import java.util.List;
import org.hibernate.Session;
import org.junit.jupiter.api.Test;

/**
 * Directly verifies that the workspace filter declared on the mapped superclass
 * ({@code TenantEntity}) is inherited by every tenant entity and, once enabled,
 * actually restricts queries to that workspace.
 */
class FilterWiringTest extends IntegrationTest {

    @Test
    void filterIsInheritedFromMappedSuperclassAndScopesQueries() {
        Account ownerA = register("fw-a");
        long wsA = createWorkspace(ownerA, "Filter A " + suffix(), null);
        Account ownerB = register("fw-b");
        long wsB = createWorkspace(ownerB, "Filter B " + suffix(), null);

        long repA = repoRep(wsA, "Rep-Of-A");
        long repB = repoRep(wsB, "Rep-Of-B");

        List<Rep> visibleForB = tx().execute(status -> {
            Session session = entityManager.unwrap(Session.class);
            // Throws at runtime if the @Filter was not inherited from TenantEntity.
            session.enableFilter(TenantContext.FILTER_NAME)
                    .setParameter("workspaceId", wsB);
            return session.createQuery("from Rep", Rep.class).getResultList();
        });

        assertThat(visibleForB).extracting(Rep::getId).containsExactly(repB);
        assertThat(visibleForB).extracting(Rep::getId).doesNotContain(repA);

        List<Rep> visibleForA = tx().execute(status -> {
            Session session = entityManager.unwrap(Session.class);
            session.enableFilter(TenantContext.FILTER_NAME)
                    .setParameter("workspaceId", wsA);
            return session.createQuery("from Rep", Rep.class).getResultList();
        });
        assertThat(visibleForA).extracting(Rep::getId).contains(repA);
    }

    private static String suffix() {
        return java.util.UUID.randomUUID().toString().substring(0, 8);
    }
}
