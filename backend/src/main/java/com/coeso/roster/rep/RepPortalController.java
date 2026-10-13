package com.coeso.roster.rep;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Rep-portal endpoints. Every route is keyed to the caller's own linked rep
 * profile — no ids in the path or query — so a rep-role user can never address
 * another rep's data.
 */
@RestController
@RequestMapping("/api/me")
public class RepPortalController {

    private final RepPortalService service;

    public RepPortalController(RepPortalService service) {
        this.service = service;
    }

    @GetMapping("/rep")
    public RepPortalService.MyRepResponse myRep() {
        return service.me();
    }

    @GetMapping("/placement")
    public RepPortalService.MyPlacementResponse myPlacement() {
        return service.myPlacement();
    }

    @GetMapping("/open-offers")
    public List<RepPortalService.OpenOfferResponse> openOffers() {
        return service.openOffers();
    }
}
