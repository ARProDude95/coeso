package com.coeso.roster.workspace;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Invite endpoints. Workspace-scoped management routes (create/list/revoke)
 * require admin+. The preview/accept routes are keyed by the raw token alone —
 * the acceptor is not a member yet — and resolve the workspace from the invite
 * row, never from a header.
 */
@RestController
@RequestMapping("/api")
public class InviteController {

    private final InviteService inviteService;

    public InviteController(InviteService inviteService) {
        this.inviteService = inviteService;
    }

    public record InviteBody(@Valid String email, String role, Integer days) {
    }

    @PostMapping("/invites")
    public ResponseEntity<InviteService.CreatedInvite> create(@RequestBody InviteBody body) {
        InviteService.InviteRequest request = new InviteService.InviteRequest(
                body.email(),
                body.role() == null ? null : com.coeso.roster.common.WorkspaceRole.parse(body.role()),
                body.days());
        return ResponseEntity.status(HttpStatus.CREATED).body(inviteService.create(request));
    }

    @GetMapping("/invites")
    public List<InviteService.InviteResponse> list() {
        return inviteService.list();
    }

    @DeleteMapping("/invites/{id}")
    public ResponseEntity<Void> revoke(@PathVariable Long id) {
        inviteService.revoke(id);
        return ResponseEntity.noContent().build();
    }

    /** What a link is for, before signing in. Keyed by token only. */
    @GetMapping("/invites/preview")
    public InviteService.InvitePreview preview(@RequestParam String token) {
        return inviteService.preview(token);
    }

    /** Accepts as the authenticated caller. Keyed by token only. */
    @PostMapping("/invites/accept")
    public InviteService.AcceptResult accept(@RequestParam String token) {
        return inviteService.accept(token);
    }
}
