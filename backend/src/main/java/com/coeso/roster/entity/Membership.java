package com.coeso.roster.entity;

import com.coeso.roster.common.WorkspaceRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinColumns;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.Filter;

/** A user's membership in a workspace, with a per-workspace role. */
@Entity
@Table(name = "memberships")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class Membership extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumn(name = "user_id", referencedColumnName = "id",
            insertable = false, updatable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private WorkspaceRole role;

    /** Optional link between the login account and a rep profile in this workspace. */
    @Column(name = "rep_id")
    private Long repId;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "rep_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Rep rep;

    public Long getId() {
        return id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public WorkspaceRole getRole() {
        return role;
    }

    public void setRole(WorkspaceRole role) {
        this.role = role;
    }

    public Long getRepId() {
        return repId;
    }

    public void setRepId(Long repId) {
        this.repId = repId;
    }

    public Rep getRep() {
        return rep;
    }

    public void setRep(Rep rep) {
        this.rep = rep;
    }
}
