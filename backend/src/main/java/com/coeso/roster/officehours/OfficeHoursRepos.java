package com.coeso.roster.officehours;

import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.OfficeHourBooking;
import com.coeso.roster.entity.OfficeHourSlot;
import com.coeso.roster.entity.PayoutLedgerEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.repository.query.Param;

/**
 * Repository interfaces for paid office hours, kept in this package so the
 * shared Repositories.java stays untouched (each feature owns its interfaces).
 * All tenant-owned tables carry the workspace Hibernate filter, and reads are
 * called only inside a request that has a resolved TenantContext.
 */
public final class OfficeHoursRepos {

    private OfficeHoursRepos() {
    }

    public interface OfficeHourSlotRepository
            extends JpaRepository<OfficeHourSlot, Long> {

        // Open, future slots sorted soonest first (the storefront list).
        java.util.List<OfficeHourSlot> findByWorkspaceIdAndStatus(
                @Param("workspaceId") Long workspaceId, OfficeHourSlot.Status status);

        java.util.List<OfficeHourSlot> findByWorkspaceIdAndExpertUserIdOrderByStartsAtDesc(
                @Param("workspaceId") Long workspaceId, Long expertUserId);
    }

    public interface OfficeHourBookingRepository
            extends JpaRepository<OfficeHourBooking, Long> {

        java.util.List<OfficeHourBooking> findByWorkspaceIdAndMemberUserId(
                @Param("workspaceId") Long workspaceId, Long memberUserId);

        java.util.List<OfficeHourBooking> findByWorkspaceIdAndExpertUserId(
                @Param("workspaceId") Long workspaceId, Long expertUserId);

        java.util.Optional<OfficeHourBooking> findFirstByWorkspaceIdAndSlotId(
                @Param("workspaceId") Long workspaceId, Long slotId);
    }

    public interface PayoutLedgerEntryRepository
            extends JpaRepository<PayoutLedgerEntry, Long> {

        java.util.List<PayoutLedgerEntry> findByWorkspaceIdAndExpertUserId(
                @Param("workspaceId") Long workspaceId, Long expertUserId);

        java.util.List<PayoutLedgerEntry> findByWorkspaceId(
                @Param("workspaceId") Long workspaceId);
    }

    public interface MembershipExpertRepository extends JpaRepository<Membership, Long> {

        java.util.Optional<Membership> findByWorkspaceIdAndUserId(
                @Param("workspaceId") Long workspaceId, Long userId);
    }
}
