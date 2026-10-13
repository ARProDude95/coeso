package com.coeso.roster.entity;

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
import java.time.LocalDate;

/**
 * An open position from a client. Stored status is only open/closed; the
 * effective status (Open / Filled / Closed) is derived from active placements
 * versus seats at query time.
 */
@Entity
@Table(name = "offers")
@Filter(name = TenantContextFilter.NAME, condition = "workspace_id = :workspaceId")
public class Offer extends TimestampedTenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "client_id", nullable = false)
    private Long clientId;

    @ManyToOne(fetch = FetchType.EAGER, optional = false)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "client_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Client client;

    @Column(name = "vertical_id")
    private Long verticalId;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumns({
            @JoinColumn(name = "workspace_id", referencedColumnName = "workspace_id",
                    insertable = false, updatable = false),
            @JoinColumn(name = "vertical_id", referencedColumnName = "id",
                    insertable = false, updatable = false)
    })
    private Vertical vertical;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(nullable = false)
    private Integer seats = 1;

    @Column(length = 4000)
    private String notes;

    @Column(name = "opens_at")
    private LocalDate opensAt;

    @Column(name = "closes_at")
    private LocalDate closesAt;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private OfferStatus status = OfferStatus.OPEN;

    public Long getId() {
        return id;
    }

    public Long getClientId() {
        return clientId;
    }

    public void setClientId(Long clientId) {
        this.clientId = clientId;
    }

    public Client getClient() {
        return client;
    }

    public void setClient(Client client) {
        this.client = client;
    }

    public Long getVerticalId() {
        return verticalId;
    }

    public void setVerticalId(Long verticalId) {
        this.verticalId = verticalId;
    }

    public Vertical getVertical() {
        return vertical;
    }

    public void setVertical(Vertical vertical) {
        this.vertical = vertical;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Integer getSeats() {
        return seats;
    }

    public void setSeats(Integer seats) {
        this.seats = seats;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public LocalDate getOpensAt() {
        return opensAt;
    }

    public void setOpensAt(LocalDate opensAt) {
        this.opensAt = opensAt;
    }

    public LocalDate getClosesAt() {
        return closesAt;
    }

    public void setClosesAt(LocalDate closesAt) {
        this.closesAt = closesAt;
    }

    public OfferStatus getStatus() {
        return status;
    }

    public void setStatus(OfferStatus status) {
        this.status = status;
    }
}
