package com.coeso.roster.plan;

import com.coeso.roster.common.PlanLimitException;
import com.coeso.roster.entity.Plan;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.repo.Repositories.PlanRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import org.springframework.stereotype.Service;

/**
 * Enforces the workspace plan's max_reps / max_members limits in the service
 * layer, raising a 402 PAYMENT_REQUIRED-style PlanLimitException when the
 * ceiling would be exceeded. NULL limits mean unlimited.
 */
@Service
public class PlanLimitService {

    private final WorkspaceRepository workspaces;
    private final PlanRepository plans;

    public PlanLimitService(WorkspaceRepository workspaces, PlanRepository plans) {
        this.workspaces = workspaces;
        this.plans = plans;
    }

    /** @param currentRows how many rows already exist for the resource */
    public void assertCanAddRep(Long workspaceId, long currentRows) {
        Plan plan = planFor(workspaceId);
        assertCapacity(plan.getMaxReps(), currentRows, "reps", plan);
    }

    public void assertCanAddMember(Long workspaceId, long currentRows) {
        Plan plan = planFor(workspaceId);
        assertCapacity(plan.getMaxMembers(), currentRows, "members", plan);
    }

    private Plan planFor(Long workspaceId) {
        Workspace workspace = workspaces.findById(workspaceId)
                .orElseThrow(() -> new IllegalStateException(
                        "Workspace " + workspaceId + " not found while checking plan limits"));
        return plans.findById(workspace.getPlan().getId())
                .orElseThrow(() -> new IllegalStateException("Plan row missing for workspace"));
    }

    private static void assertCapacity(Integer max, long current, String resource, Plan plan) {
        if (max == null) {
            return; // unlimited plan
        }
        if (current >= max) {
            throw new PlanLimitException(resource, current, max,
                    "Plan '" + plan.getCode() + "' allows at most " + max + " " + resource
                            + " (" + current + " in use). Upgrade the plan to add more.");
        }
    }
}
