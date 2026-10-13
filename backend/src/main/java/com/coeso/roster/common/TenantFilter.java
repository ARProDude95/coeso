package com.coeso.roster.common;

import com.coeso.roster.auth.UserPrincipal;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.workspace.MembershipService;
import com.coeso.roster.workspace.Slugs;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.Optional;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Resolves the active workspace for the request from the request's subdomain
 * (multi-tenant hosting, e.g. {@code acme.example.com}) when present, else
 * from the X-Workspace header (id or slug), and verifies the authenticated
 * user has a membership in it. The value is never taken from a body or query
 * parameter. Requests without a resolvable workspace proceed with an empty
 * context; workspace-scoped endpoints then answer 400. Requests whose caller
 * is not a member are rejected with 403.
 */
public class TenantFilter extends org.springframework.web.filter.OncePerRequestFilter {

    private final MembershipService membershipService;
    private final ObjectMapper objectMapper;

    public TenantFilter(MembershipService membershipService, ObjectMapper objectMapper) {
        this.membershipService = membershipService;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        try {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            if (!(auth != null && auth.getPrincipal() instanceof UserPrincipal principal)) {
                filterChain.doFilter(request, response);
                return;
            }
            String workspaceKey = subdomainOf(request);
            if (workspaceKey == null) {
                String header = request.getHeader("X-Workspace");
                if (header != null && !header.isBlank()) {
                    workspaceKey = header.trim();
                }
            }
            if (workspaceKey == null) {
                filterChain.doFilter(request, response);
                return;
            }
            Optional<Membership> membership;
            try {
                membership = membershipService.resolve(workspaceKey, principal.id());
            } catch (RuntimeException e) {
                membership = Optional.empty();
            }
            if (membership.isEmpty()) {
                reject(response);
                return;
            }
            filterChain.doFilter(request, response);
        } finally {
            TenantContext.clear();
        }
    }

    private void reject(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json");
        objectMapper.writeValue(response.getOutputStream(),
                Map.of("status", 403, "code", "WORKSPACE_ACCESS_DENIED",
                        "message", "You are not a member of the requested workspace"));
    }

    /**
     * Extracts a workspace slug from the first label of the Host header when the
     * request arrives on a subdomain of a known base domain, e.g.
     * {@code acme.roster.test} with base domain {@code roster.test} yields
     * {@code acme}. Returns null for apex hosts, IPs, localhost and any label
     * that is not a plausible slug (single-label hosts and loopback are never
     * treated as subdomains).
     */
    private String subdomainOf(HttpServletRequest request) {
        String host = request.getHeader("Host");
        if (host == null || host.isBlank()) {
            return null;
        }
        // Strip the port; IPv6 literals are never subdomains.
        String hostname = host.trim().toLowerCase(java.util.Locale.ROOT);
        int colon = hostname.indexOf(':');
        if (colon >= 0) {
            hostname = hostname.substring(0, colon);
        }
        if (hostname.startsWith("[") || hostname.matches("\\d+\\.\\d+\\.\\d+\\.\\d+")) {
            return null;
        }
        int firstDot = hostname.indexOf('.');
        if (firstDot <= 0) {
            return null; // apex or localhost
        }
        String label = hostname.substring(0, firstDot);
        // "www" is a reserved slug, so it is never a workspace subdomain.
        if (Slugs.RESERVED.contains(label) || !label.matches("[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?")) {
            return null;
        }
        return label;
    }
}
