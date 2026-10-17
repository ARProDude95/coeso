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

    /** Plan codes that unlock [PRO] features (Phase 7, 12). */
    private static final java.util.Set<String> PRO_PLAN_CODES =
            java.util.Set.of("pro", "unlimited");

    /**
     * [PRO] feature gate: raises a 402 PRO_FEATURE_REQUIRED envelope with an
     * upgrade message when the workspace's plan is below Pro.
     */
    public void assertProFeature(Long workspaceId, String feature) {
        Plan plan = planFor(workspaceId);
        if (!PRO_PLAN_CODES.contains(plan.getCode())) {
            throw new com.coeso.roster.common.ProFeatureRequiredException(feature,
                    "Feature '" + feature + "' needs the Pro plan, but this workspace is on '"
                            + plan.getName() + "'. Upgrade to unlock performance, "
                            + "commissions and payouts.");
        }
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
