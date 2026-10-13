package com.coeso.roster.client;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.Client;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/** Client CRUD, workspace-scoped. Deleting a client that has offers is blocked. */
@Service
public class ClientService {

    public record ClientRequest(String name, String contactEmail, String notes) {
    }

    public record ClientResponse(Long id, String name, String contactEmail, String notes) {
    }

    private final ScopedQueries scoped;
    private final AuditService auditService;

    @PersistenceContext
    private EntityManager entityManager;

    public ClientService(ScopedQueries scoped, AuditService auditService) {
        this.scoped = scoped;
        this.auditService = auditService;
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public List<ClientResponse> list() {
        TenantContext.requireWorkspaceId();
        return entityManager
                .createQuery("select c from Client c order by c.name asc", Client.class)
                .getResultList()
                .stream()
                .map(ClientService::toResponse)
                .toList();
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public ClientResponse create(ClientRequest request) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Client client = new Client();
        client.setWorkspaceId(workspaceId);
        apply(client, request);
        entityManager.persist(client);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_CREATE, "client", client.getId(),
                Map.of("name", client.getName()));
        return toResponse(client);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public ClientResponse update(Long id, ClientRequest request) {
        TenantContext.requireWorkspaceId();
        Client client = scoped.require(Client.class, id, "Client");
        apply(client, request);
        entityManager.flush();
        auditService.record(AuditLog.ACTION_UPDATE, "client", client.getId(),
                Map.of("name", client.getName()));
        return toResponse(client);
    }

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public void delete(Long id) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        Client client = scoped.require(Client.class, id, "Client");
        Long offerCount = entityManager
                .createQuery("select count(o) from Offer o"
                        + " where o.workspaceId = :workspaceId and o.clientId = :clientId", Long.class)
                .setParameter("workspaceId", workspaceId)
                .setParameter("clientId", id)
                .getSingleResult();
        if (offerCount > 0) {
            throw new ConflictException("Client has " + offerCount + " offer(s); delete them first");
        }
        entityManager.remove(client);
        auditService.record(AuditLog.ACTION_DELETE, "client", id, Map.of("name", client.getName()));
    }

    private static void apply(Client client, ClientRequest request) {
        String name = request.name() == null ? "" : request.name().trim();
        if (name.isEmpty()) {
            throw new com.coeso.roster.common.BadRequestException("Client name is required");
        }
        client.setName(name);
        client.setContactEmail(request.contactEmail() == null || request.contactEmail().isBlank()
                ? null : request.contactEmail().trim());
        client.setNotes(request.notes());
    }

    private static ClientResponse toResponse(Client client) {
        return new ClientResponse(client.getId(), client.getName(), client.getContactEmail(),
                client.getNotes());
    }
}
