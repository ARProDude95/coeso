package com.coeso.roster.discord;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Workspace Discord connection settings (admin/owner only, enforced in the service). */
@RestController
@RequestMapping("/api/discord")
public class DiscordSettingsController {

    private final DiscordSettingsService discordSettingsService;

    public DiscordSettingsController(DiscordSettingsService discordSettingsService) {
        this.discordSettingsService = discordSettingsService;
    }

    @GetMapping("/settings")
    public DiscordSettingsService.SettingsResponse get() {
        return discordSettingsService.get();
    }

    @PutMapping("/settings")
    public DiscordSettingsService.SettingsResponse save(
            @Valid @RequestBody DiscordSettingsService.SettingsRequest request) {
        return discordSettingsService.save(request);
    }
}
