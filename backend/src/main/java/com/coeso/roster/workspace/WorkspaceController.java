package com.coeso.roster.workspace;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/workspaces")
public class WorkspaceController {

    public record CreateRequest(
            @NotBlank(message = "name is required") String name,
            String slug) {
    }

    private final WorkspaceService workspaceService;

    public WorkspaceController(WorkspaceService workspaceService) {
        this.workspaceService = workspaceService;
    }

    @GetMapping
    public List<MembershipService.WorkspaceSummary> list() {
        return workspaceService.list();
    }

    @PostMapping
    public ResponseEntity<WorkspaceService.WorkspaceResponse> create(
            @Valid @RequestBody CreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(workspaceService.create(new WorkspaceService.CreateWorkspaceRequest(
                        request.name(), request.slug())));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        workspaceService.delete(id);
        return ResponseEntity.noContent().build();
    }

    // -------------------------------------------------------------- branding

    @GetMapping("/branding")
    public WorkspaceService.BrandingResponse branding() {
        return workspaceService.branding();
    }

    @PutMapping("/branding")
    public WorkspaceService.BrandingResponse updateBranding(
            @RequestBody WorkspaceService.BrandingRequest request) {
        return workspaceService.updateBranding(request);
    }

    // -------------------------------------------------- settings (Phase 7)

    @GetMapping("/settings")
    public WorkspaceService.SettingsResponse settings() {
        return workspaceService.settings();
    }

    @PutMapping("/settings")
    public WorkspaceService.SettingsResponse updateSettings(
            @RequestBody WorkspaceService.SettingsRequest request) {
        return workspaceService.updateSettings(request);
    }
}
