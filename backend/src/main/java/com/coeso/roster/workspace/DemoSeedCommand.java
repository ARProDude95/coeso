package com.coeso.roster.workspace;

import com.coeso.roster.common.TenantContext;
import com.coeso.roster.common.WorkspaceRole;
import com.coeso.roster.entity.Client;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.Membership;
import com.coeso.roster.entity.Offer;
import com.coeso.roster.entity.OfferStatus;
import com.coeso.roster.entity.Placement;
import com.coeso.roster.entity.PlacementStatus;
import com.coeso.roster.entity.Plan;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.Subscription;
import com.coeso.roster.entity.SubscriptionStatus;
import com.coeso.roster.entity.User;
import com.coeso.roster.entity.Vertical;
import com.coeso.roster.entity.Workspace;
import com.coeso.roster.entity.WorkspaceStatus;
import com.coeso.roster.repo.Repositories.ClientRepository;
import com.coeso.roster.repo.Repositories.ExperienceLevelRepository;
import com.coeso.roster.repo.Repositories.MembershipRepository;
import com.coeso.roster.repo.Repositories.OfferRepository;
import com.coeso.roster.repo.Repositories.PlanRepository;
import com.coeso.roster.repo.Repositories.PlacementRepository;
import com.coeso.roster.repo.Repositories.RepRepository;
import com.coeso.roster.repo.Repositories.RepStatusRepository;
import com.coeso.roster.repo.Repositories.SubscriptionRepository;
import com.coeso.roster.repo.Repositories.UserRepository;
import com.coeso.roster.repo.Repositories.VerticalRepository;
import com.coeso.roster.repo.Repositories.WorkspaceRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Demo seed, run explicitly:
 * {@code mvn spring-boot:run -Dspring-boot.run.arguments="--seed-demo"}
 *
 * <p>Creates a demo owner plus a workspace with 50 reps and 20 offers of
 * realistic sample data across all three seeded verticals, with a mix of bench,
 * training and placed reps. Idempotent: re-running reuses the existing demo
 * user and workspace and skips content seeding if 50 reps already exist.
 *
 * <p>Not a bean at runtime unless the flag is passed — it implements
 * {@link CommandLineRunner} but no-ops without {@code --seed-demo}, so normal
 * startup and the test suites are unaffected.
 */
@Component
public class DemoSeedCommand implements CommandLineRunner {

    public static final String DEMO_EMAIL = "demo@roster.test";
    public static final String DEMO_PASSWORD = "demo-password-123";
    public static final String DEMO_WORKSPACE_SLUG = "demo-agency";

    private static final String[] FIRST_NAMES = {
        "Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Lena", "Owen", "Ruby", "Caleb",
        "Nora", "Miles", "Ivy", "Jonah", "Cleo", "Theo", "Wren", "Felix", "Mara", "Hugo",
        "Sasha", "Dean", "Priya", "Kian", "Talia", "Marcus", "Ines", "Dylan", "Rosa", "Andre",
        "Nina", "Victor", "Leila", "Simon", "Esme", "Axel", "Tara", "Nolan", "Freya", "Diego",
        "Bianca", "Rafael", "Sienna", "Matteo", "Alba", "Jonas", "Yara", "Emil", "Rhea", "Luca",
    };
    private static final String[] LAST_NAMES = {
        "Carter", "Nguyen", "Alvarez", "Bishop", "Chen", "Duarte", "Egan", "Farrow", "Gupta",
        "Hale", "Ibrahim", "Jensen", "Kowalski", "Lindqvist", "Moreau", "Novak", "Okafor",
        "Petrov", "Quinn", "Reyes", "Sato", "Tran", "Ueda", "Vargas", "Whitfield", "Xu",
        "Yilmaz", "Zamora", "Ashford", "Beaumont", "Castellanos", "Davenport", "Ellison",
        "Fontaine", "Grimaldi", "Hollis", "Iversen", "Jarvis", "Kaur", "Lombardi", "Mercer",
        "Nakamura", "Ortiz", "Pemberton", "Rasheed", "Sinclair", "Thorne", "Vasquez",
        "Wexler", "Zielinski",
    };
    private static final String[] CLIENT_NAMES = {
        "Northwind Software", "Halcyon Media", "Beacon Financial", "Verdant Health",
        "Atlas Logistics", "Cobalt Games", "Lumen Telecom", "Sable Fashion", "Ironwood Legal",
        "Prism Analytics", "Solstice Energy", "Meridian Travel", "Quartz Robotics",
        "Ember Foods", "Cascade Systems", "Nimbus Cloud", "Onyx Security", "Harbor Insurance",
        "Saffron Hotels", "Granite Mining",
    };
    private static final String[] REP_NOTES = {
        "Strong closer, prefers morning calls", "New to sales, fast learner",
        "Excellent with enterprise clients", "Needs coaching on objection handling",
        "Top performer last quarter", "Fluent in Spanish and English",
        "Remote-friendly, US time zone", "Great with renewals",
    };
    private static final String[] OFFER_ROLES = {
        "Account Executive", "Sales Development Rep", "Partnerships Lead",
        "Media Buyer", "Campaign Manager", "Business Development Manager",
        "Growth Lead", "Channel Manager",
    };
    private static final String[] OFFER_REGIONS = {"EMEA", "NA", "APAC", "LATAM", "Remote"};

    private final UserRepository users;
    private final WorkspaceRepository workspaces;
    private final PlanRepository plans;
    private final MembershipRepository memberships;
    private final SubscriptionRepository subscriptions;
    private final DefaultSeedService defaultSeedService;
    private final VerticalRepository verticals;
    private final RepStatusRepository statuses;
    private final ExperienceLevelRepository levels;
    private final RepRepository reps;
    private final ClientRepository clients;
    private final OfferRepository offers;
    private final PlacementRepository placements;
    private final PasswordEncoder passwordEncoder;

    public DemoSeedCommand(UserRepository users, WorkspaceRepository workspaces,
                           PlanRepository plans, MembershipRepository memberships,
                           SubscriptionRepository subscriptions,
                           DefaultSeedService defaultSeedService,
                           VerticalRepository verticals, RepStatusRepository statuses,
                           ExperienceLevelRepository levels, RepRepository reps,
                           ClientRepository clients, OfferRepository offers,
                           PlacementRepository placements, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.workspaces = workspaces;
        this.plans = plans;
        this.memberships = memberships;
        this.subscriptions = subscriptions;
        this.defaultSeedService = defaultSeedService;
        this.verticals = verticals;
        this.statuses = statuses;
        this.levels = levels;
        this.reps = reps;
        this.clients = clients;
        this.offers = offers;
        this.placements = placements;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        for (String arg : args) {
            if ("--seed-demo".equals(arg)) {
                seed();
                return;
            }
        }
    }

    @Transactional
    public void seed() {
        System.out.println("[demo] seeding demo workspace…");

        User demoUser = users.findByEmail(DEMO_EMAIL).orElseGet(() -> {
            User user = new User();
            user.setEmail(DEMO_EMAIL);
            user.setDisplayName("Demo Owner");
            user.setPasswordHash(passwordEncoder.encode(DEMO_PASSWORD));
            return users.save(user);
        });

        Workspace workspace = workspaces.findBySlug(DEMO_WORKSPACE_SLUG).orElseGet(() -> {
            Plan freePlan = plans.findByCode("free")
                    .orElseThrow(() -> new IllegalStateException("free plan seed missing"));
            Workspace created = new Workspace();
            created.setName("Demo Agency");
            created.setSlug(DEMO_WORKSPACE_SLUG);
            created.setPlan(freePlan);
            created.setStatus(WorkspaceStatus.ACTIVE);
            Workspace saved = workspaces.save(created);
            defaultSeedService.seed(saved.getId());
            return saved;
        });
        Long workspaceId = workspace.getId();

        if (memberships.findByUserIdAndWorkspaceId(demoUser.getId(), workspaceId).isEmpty()) {
            Membership membership = new Membership();
            membership.setWorkspaceId(workspaceId);
            membership.setUserId(demoUser.getId());
            membership.setRole(WorkspaceRole.OWNER);
            memberships.save(membership);
        }
        if (subscriptions.findByWorkspaceId(workspaceId).isEmpty()) {
            Subscription subscription = new Subscription();
            subscription.setWorkspaceId(workspaceId);
            subscription.setPlanId(workspace.getPlan().getId());
            subscription.setStatus(SubscriptionStatus.TRIALING);
            subscription.setTrialEndsAt(LocalDateTime.now().plusDays(14));
            subscriptions.save(subscription);
        }

        seedContent(workspaceId);
        System.out.println("[demo] done. Log in as " + DEMO_EMAIL + " / " + DEMO_PASSWORD
                + " and open the '" + DEMO_WORKSPACE_SLUG + "' workspace.");
    }

    private void seedContent(Long workspaceId) {
        long existingReps = reps.findAll().stream()
                .filter(r -> r.getWorkspaceId().equals(workspaceId)).count();
        if (existingReps >= 50) {
            System.out.println("[demo] content already seeded; skipping");
            return;
        }

        List<Vertical> verticalRows = verticals.findAll().stream()
                .filter(v -> v.getWorkspaceId().equals(workspaceId)).toList();
        List<RepStatus> statusRows = statuses.findAll().stream()
                .filter(s -> s.getWorkspaceId().equals(workspaceId)).toList();
        List<ExperienceLevel> levelRows = levels.findAll().stream()
                .filter(l -> l.getWorkspaceId().equals(workspaceId)).toList();

        Random random = new Random(20261011L);

        List<Client> clientRows = new ArrayList<>();
        for (String name : CLIENT_NAMES) {
            Client client = new Client();
            client.setWorkspaceId(workspaceId);
            client.setName(name);
            client.setContactEmail("hello@" + slug(name) + ".example.test");
            clientRows.add(clients.save(client));
        }

        // All 50 reps are created here in one go; the free plan caps reps at
        // 10, so the demo workspace is moved to the unlimited plan first.
        setUpgradeToUnlimited(workspaceId);

        List<Rep> repRows = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            Rep rep = new Rep();
            rep.setWorkspaceId(workspaceId);
            rep.setName(FIRST_NAMES[i] + " " + LAST_NAMES[(i * 7) % LAST_NAMES.length]);
            rep.setEmail(slug(rep.getName()).replace('-', '.') + "@reps.example.test");
            rep.setDiscordUserId(String.valueOf(100000000000000000L + i));
            Vertical vertical = verticalRows.get(i % verticalRows.size());
            rep.setVerticalId(vertical.getId());
            rep.setVertical(vertical);
            RepStatus status = statusRows.get(i % statusRows.size());
            rep.setStatusId(status.getId());
            rep.setStatus(status);
            ExperienceLevel level = levelRows.get(i % levelRows.size());
            rep.setExperienceLevelId(level.getId());
            rep.setExperienceLevel(level);
            rep.setNotes(REP_NOTES[random.nextInt(REP_NOTES.length)]);
            rep.setJoinedDate(LocalDate.now().minusDays(30 + random.nextInt(600)));
            repRows.add(reps.save(rep));
        }

        List<Offer> offerRows = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            Offer offer = new Offer();
            offer.setWorkspaceId(workspaceId);
            Client client = clientRows.get(i % clientRows.size());
            offer.setClientId(client.getId());
            offer.setClient(client);
            Vertical vertical = verticalRows.get(i % verticalRows.size());
            offer.setVerticalId(vertical.getId());
            offer.setVertical(vertical);
            offer.setTitle(OFFER_ROLES[random.nextInt(OFFER_ROLES.length)] + " — "
                    + OFFER_REGIONS[random.nextInt(OFFER_REGIONS.length)]);
            offer.setSeats(1 + random.nextInt(4));
            offer.setStatus(OfferStatus.OPEN);
            offer.setOpensAt(LocalDate.now().minusDays(random.nextInt(20)));
            offer.setNotes("Hiring for " + client.getName());
            offerRows.add(offers.save(offer));
        }

        // Fill seats until roughly two thirds of the reps are placed; the rest
        // stay on the bench / in training, giving a realistic mix.
        int placedCount = 0;
        int repCursor = 0;
        for (Offer offer : offerRows) {
            int seatsToFill = Math.min(offer.getSeats(), 1 + random.nextInt(2));
            for (int s = 0; s < seatsToFill && repCursor < 33; s++) {
                Rep rep = repRows.get(repCursor++);
                Placement placement = new Placement();
                placement.setWorkspaceId(workspaceId);
                placement.setOfferId(offer.getId());
                placement.setOffer(offer);
                placement.setRepId(rep.getId());
                placement.setRep(rep);
                placement.setStatus(PlacementStatus.ACTIVE);
                placement.setPlacedAt(LocalDateTime.now().minusDays(random.nextInt(30)));
                placements.save(placement);
                placedCount++;
            }
        }
        System.out.println("[demo] seeded 50 reps, 20 offers, " + placedCount
                + " active placements (rest on bench/training)");
    }

    /** Demo workspaces use the unlimited plan so the seed is never truncated. */
    private void setUpgradeToUnlimited(Long workspaceId) {
        Workspace workspace = workspaces.findById(workspaceId).orElseThrow();
        Plan unlimited = plans.findByCode("unlimited").orElse(null);
        if (unlimited == null || unlimited.getId().equals(workspace.getPlan().getId())) {
            return;
        }
        workspace.setPlan(unlimited);
        workspaces.save(workspace);
        subscriptions.findByWorkspaceId(workspaceId)
                .ifPresent(subscription -> subscription.setPlanId(unlimited.getId()));
    }

    private static String slug(String name) {
        return name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+|-+$)", "");
    }
}
