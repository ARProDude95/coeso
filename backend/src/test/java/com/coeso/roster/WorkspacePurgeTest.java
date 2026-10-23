package com.coeso.roster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.purge.WorkspacePurgeJob;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * WorkspacePurgeJob's FK bug (PROGRESS "Known issues"): the CHILD_TABLES
 * whitelist was never extended past V1, so purging a soft-deleted workspace
 * with rows in any later table died on the first FK violation
 * ({@code Cannot delete or update a parent row}) and the children were never
 * removed — observed live 2026-10-20 on {@code offer_required_skills} (V4)
 * blocking {@code offers}.
 *
 *  - the whitelist must cover <b>every</b> tenant table the live schema has
 *    (information_schema, so a future migration that forgets the list fails
 *    here) and list each child before every whitelisted table it references,
 *  - the real job must purge a soft-deleted workspace across V4/V9/V10/V11
 *    rows — including the reported blocker — and leave the workspace row
 *    itself as a tombstone.
 */
class WorkspacePurgeTest extends IntegrationTest {

    @Autowired private WorkspacePurgeJob purgeJob;

    private final String sfx = UUID.randomUUID().toString().substring(0, 8);

    @Test
    @SuppressWarnings("unchecked")
    void whitelistCoversEveryTenantTableAndDeletesChildrenBeforeParents() {
        List<String> whitelist = WorkspacePurgeJob.CHILD_TABLES;

        // Every table carrying workspace_id — exactly the whitelist plus the
        // workspaces row itself, which the job deliberately keeps.
        List<String> tenantTables = entityManager.createNativeQuery(
                        "SELECT TABLE_NAME FROM information_schema.COLUMNS"
                                + " WHERE TABLE_SCHEMA = DATABASE()"
                                + " AND COLUMN_NAME = 'workspace_id'"
                                + " AND TABLE_NAME <> 'workspaces'")
                .getResultList();
        assertThat(tenantTables)
                .as("CHILD_TABLES must match the schema's tenant tables exactly "
                        + "(missing tables keep failing the purge; extra tables are typos)")
                .containsExactlyInAnyOrderElementsOf(whitelist);

        // Every FK between two whitelisted tables: the child's row must be
        // deletable before the parent it points at. Self-references (ledger ->
        // ledger) are handled by InnoDB inside one DELETE and are skipped.
        List<Object[]> pairs = entityManager.createNativeQuery(
                        "SELECT DISTINCT c.TABLE_NAME, c.REFERENCED_TABLE_NAME"
                                + " FROM information_schema.KEY_COLUMN_USAGE c"
                                + " WHERE c.TABLE_SCHEMA = DATABASE()"
                                + " AND c.REFERENCED_TABLE_NAME IS NOT NULL"
                                + " AND c.TABLE_NAME <> c.REFERENCED_TABLE_NAME"
                                + " AND c.TABLE_NAME IN (:list)"
                                + " AND c.REFERENCED_TABLE_NAME IN (:list)")
                .setParameter("list", whitelist)
                .getResultList();
        assertThat(pairs).isNotEmpty();
        for (Object[] pair : pairs) {
            String child = (String) pair[0];
            String parent = (String) pair[1];
            assertThat(whitelist.indexOf(child))
                    .as("%s must be purged before %s (FK %s -> %s)",
                            child, parent, child, parent)
                    .isLessThan(whitelist.indexOf(parent));
        }
    }

    @Test
    void purgesSoftDeletedWorkspaceAcrossGenerationsIncludingTheReportedBlocker()
            throws Exception {
        Account owner = register("pg-owner");
        long ws = createWorkspace(owner, "Purge WS " + sfx, null);
        Account member = register("pg-owner-m");
        addMember(ws, member.userId(), WorkspaceRole.MANAGER);

        // The chain that failed in production: skill tag + offer requirement
        // (V4) sitting on an offer (V1) — offer_required_skills used to block
        // the offers delete.
        long client = repoClient(ws, "Purge Client " + sfx);
        long offer = repoOffer(ws, client, "Purge AE", 1);
        tx().executeWithoutResult(status -> {
            entityManager.createNativeQuery(
                            "INSERT INTO skill_tags (workspace_id, name) VALUES (:ws, :name)")
                    .setParameter("ws", ws)
                    .setParameter("name", "purge-tag-" + sfx)
                    .executeUpdate();
            entityManager.createNativeQuery(
                            "INSERT INTO offer_required_skills (workspace_id, offer_id, tag_id)"
                                    + " SELECT :ws, :offer, id FROM skill_tags"
                                    + " WHERE workspace_id = :ws AND name = :name")
                    .setParameter("ws", ws)
                    .setParameter("offer", offer)
                    .setParameter("name", "purge-tag-" + sfx)
                    .executeUpdate();
        });

        // V9/V10: a published pod with a member and a thread message.
        var pods = read(apiPost(owner, ws, "/api/pods/publish",
                        "{\"drafts\":[{\"industry\":\"Ops\",\"userIds\":["
                                + owner.userId() + "," + member.userId() + "]}]}")
                .andReturn());
        long podId = pods.get(0).get("id").asLong();
        apiPost(member, ws, "/api/pods/" + podId + "/messages",
                "{\"body\":\"before the purge\"}").andExpect(status().isOk());

        // V11: one engagement snapshot row.
        tx().executeWithoutResult(status -> entityManager.createNativeQuery(
                        "INSERT INTO engagement_snapshots"
                                + " (workspace_id, user_id, snapshot_date, score, days_inactive)"
                                + " VALUES (:ws, :uid, CURDATE(), 5, 0)")
                .setParameter("ws", ws)
                .setParameter("uid", owner.userId())
                .executeUpdate());

        // Soft-delete, then run the real job — it is system-wide by design
        // (no tenant context), and every statement is scoped by workspace_id.
        var workspace = workspaceRepository.findById(ws).orElseThrow();
        workspace.setStatus(WorkspaceStatus.DELETED);
        workspaceRepository.save(workspace);
        purgeJob.purgeDeletedWorkspaces();

        for (String table : WorkspacePurgeJob.CHILD_TABLES) {
            long rows = ((Number) entityManager.createNativeQuery(
                            "SELECT COUNT(*) FROM " + table + " WHERE workspace_id = :ws")
                    .setParameter("ws", ws)
                    .getSingleResult()).longValue();
            assertThat(rows).as("rows left in %s after the purge", table).isZero();
        }

        // The workspace row itself survives as a tombstone.
        var tombstone = workspaceRepository.findById(ws);
        assertThat(tombstone).isPresent();
        assertThat(tombstone.get().getStatus()).isEqualTo(WorkspaceStatus.DELETED);
    }
}
