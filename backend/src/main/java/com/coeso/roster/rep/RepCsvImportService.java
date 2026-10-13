package com.coeso.roster.rep;

import com.coeso.roster.audit.AuditService;
import com.coeso.roster.common.BadRequestException;
import com.coeso.roster.common.ScopedQueries;
import com.coeso.roster.common.TenantContext;
import com.coeso.roster.entity.AuditLog;
import com.coeso.roster.entity.ExperienceLevel;
import com.coeso.roster.entity.Rep;
import com.coeso.roster.entity.RepStatus;
import com.coeso.roster.entity.Vertical;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;

/**
 * CSV import for reps: upload → column mapping → preview with row-level
 * validation errors → import.
 *
 * <p>Two steps, both manager+:
 * <ol>
 *   <li>{@link #preview} parses the CSV, guesses the column mapping from the
 *       header row, validates every row against the workspace's lookups and
 *       plan capacity, and returns per-row errors without writing anything.</li>
 *   <li>{@link #import} applies the confirmed mapping, inserts the valid rows
 *       in one transaction, and reports which rows were skipped and why.</li>
 * </ol>
 *
 * <p>Recognised columns (by header, case-insensitive): name (required), email,
 * discord, vertical, status, experience, notes, joined. Unknown headers are
 * ignored; a missing required column is a hard error before any row is read.
 */
@Service
public class RepCsvImportService {

    /** Mappable target fields; {@code name} is mandatory. */
    public enum Field {
        NAME, EMAIL, DISCORD, VERTICAL, STATUS, EXPERIENCE, NOTES, JOINED
    }

    public record Mapping(String name, String email, String discord, String vertical,
                          String status, String experience, String notes, String joined) {
        public static Mapping empty() {
            return new Mapping(null, null, null, null, null, null, null, null);
        }
    }

    public record PreviewRow(int rowNumber, Map<String, String> values,
                             List<String> errors, boolean valid) {
    }

    public record PreviewResult(List<String> headers, Mapping suggestedMapping,
                                List<PreviewRow> rows, int validRows, int errorRows,
                                long capacityRemaining) {
    }

    public record ImportRow(int rowNumber, String outcome, String detail) {
    }

    public record ImportResult(int imported, List<ImportRow> rows) {
    }

    private static final int MAX_ROWS = 2000;

    private final ScopedQueries scoped;
    private final AuditService auditService;

    @PersistenceContext
    private EntityManager entityManager;

    public RepCsvImportService(ScopedQueries scoped, AuditService auditService) {
        this.scoped = scoped;
        this.auditService = auditService;
    }

    // ----------------------------------------------------------------- preview

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public PreviewResult preview(String csv, Mapping mapping) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (csv == null || csv.isBlank()) {
            throw new BadRequestException("CSV content is required");
        }
        List<String[]> parsed = parse(csv);
        if (parsed.isEmpty()) {
            throw new BadRequestException("CSV has no rows");
        }
        if (parsed.size() > MAX_ROWS) {
            throw new BadRequestException("CSV has too many rows (max " + MAX_ROWS + ")");
        }
        List<String> headers = List.of(parsed.get(0));
        Mapping effective = (mapping == null || mapping.name() == null)
                ? suggestMapping(headers) : mapping;
        if (effective.name() == null) {
            throw new BadRequestException(
                    "CSV must include a name column; specify the mapping explicitly");
        }

        LookupIndex index = new LookupIndex(workspaceId);
        long capacity = remainingCapacity(workspaceId);

        List<PreviewRow> rows = new ArrayList<>();
        int valid = 0;
        int errors = 0;
        for (int i = 1; i < parsed.size(); i++) {
            Map<String, String> values = rowValues(headers, parsed.get(i));
            List<String> rowErrors = validateRow(values, effective, index, i + 1);
            boolean rowValid = rowErrors.isEmpty();
            if (rowValid) {
                valid++;
            } else {
                errors++;
            }
            rows.add(new PreviewRow(i + 1, values, rowErrors, rowValid));
        }
        return new PreviewResult(headers, effective, rows, valid, errors, capacity);
    }

    // ------------------------------------------------------------------ import

    @PreAuthorize("@roles.hasAtLeast('MANAGER')")
    public ImportResult importRows(String csv, Mapping mapping) {
        Long workspaceId = TenantContext.requireWorkspaceId();
        if (csv == null || csv.isBlank()) {
            throw new BadRequestException("CSV content is required");
        }
        List<String[]> parsed = parse(csv);
        if (parsed.isEmpty()) {
            throw new BadRequestException("CSV has no rows");
        }
        if (parsed.size() > MAX_ROWS) {
            throw new BadRequestException("CSV has too many rows (max " + MAX_ROWS + ")");
        }
        List<String> headers = List.of(parsed.get(0));
        Mapping effective = (mapping == null || mapping.name() == null)
                ? suggestMapping(headers) : mapping;
        if (effective.name() == null) {
            throw new BadRequestException(
                    "CSV must include a name column; specify the mapping explicitly");
        }

        LookupIndex index = new LookupIndex(workspaceId);
        long capacity = remainingCapacity(workspaceId);

        List<ImportRow> outcomes = new ArrayList<>();
        int imported = 0;
        for (int i = 1; i < parsed.size(); i++) {
            int rowNumber = i + 1;
            Map<String, String> values = rowValues(headers, parsed.get(i));
            List<String> rowErrors = validateRow(values, effective, index, rowNumber);
            if (!rowErrors.isEmpty()) {
                outcomes.add(new ImportRow(rowNumber, "SKIPPED", String.join("; ", rowErrors)));
                continue;
            }
            if (imported >= capacity) {
                outcomes.add(new ImportRow(rowNumber, "SKIPPED",
                        "plan limit reached (" + capacity + " new reps allowed on this plan)"));
                continue;
            }
            Rep rep = new Rep();
            rep.setWorkspaceId(workspaceId);
            rep.setName(value(values, effective.name()).trim());
            rep.setEmail(trimToNull(value(values, effective.email())));
            rep.setDiscordUserId(trimToNull(value(values, effective.discord())));
            rep.setNotes(trimToNull(value(values, effective.notes())));
            rep.setJoinedDate(parseDate(trimToNull(value(values, effective.joined()))));

            String verticalName = trimToNull(value(values, effective.vertical()));
            if (verticalName != null) {
                Vertical vertical = index.vertical(verticalName);
                rep.setVerticalId(vertical.getId());
                rep.setVertical(vertical);
            }
            String statusName = trimToNull(value(values, effective.status()));
            if (statusName != null) {
                RepStatus status = index.status(statusName);
                rep.setStatusId(status.getId());
                rep.setStatus(status);
            }
            String levelName = trimToNull(value(values, effective.experience()));
            if (levelName != null) {
                ExperienceLevel level = index.level(levelName);
                rep.setExperienceLevelId(level.getId());
                rep.setExperienceLevel(level);
            }
            entityManager.persist(rep);
            entityManager.flush();
            // One audit row per created rep (entity_id is NOT NULL, and this
            // keeps the trail as precise as single-rep creation).
            auditService.record(AuditLog.ACTION_CREATE, "rep", rep.getId(),
                    Map.of("name", rep.getName(), "via", "csv_import"));
            imported++;
            outcomes.add(new ImportRow(rowNumber, "IMPORTED", rep.getName()));
        }
        entityManager.flush();

        return new ImportResult(imported, outcomes);
    }

    // ---------------------------------------------------------------- helpers

    /**
     * Rows that still fit under the plan's max_reps. Reads the plan directly
     * rather than calling {@link PlanLimitService#assertCanAddRep}: that
     * method is itself wrapped by {@code TenantAspect}, so letting it throw
     * inside this transaction would mark the shared transaction rollback-only
     * and poison the import that deliberately tolerates a full plan.
     */
    private long remainingCapacity(Long workspaceId) {
        long current = entityManager
                .createQuery("select count(r) from Rep r"
                        + " where r.workspaceId = :ws and r.deletedAt is null", Long.class)
                .setParameter("ws", workspaceId)
                .getSingleResult();
        Integer max = maxReps(workspaceId);
        if (max == null) {
            return Long.MAX_VALUE; // unlimited plan
        }
        return Math.max(0, max - current);
    }

    private Integer maxReps(Long workspaceId) {
        return entityManager
                .createQuery("select w.plan.maxReps from Workspace w where w.id = :ws",
                        Integer.class)
                .setParameter("ws", workspaceId)
                .getSingleResult();
    }

    private List<String> validateRow(Map<String, String> values, Mapping mapping,
                                     LookupIndex index, int rowNumber) {
        List<String> errors = new ArrayList<>();
        String name = trimToNull(value(values, mapping.name()));
        if (name == null) {
            errors.add("name is required");
        } else if (name.length() > 200) {
            errors.add("name is too long (max 200 characters)");
        }
        String email = trimToNull(value(values, mapping.email()));
        if (email != null && !email.contains("@")) {
            errors.add("email is not a valid address");
        }
        checkLookup(value(values, mapping.vertical), index::verticalExists, "vertical", errors);
        checkLookup(value(values, mapping.status), index::statusExists, "status", errors);
        checkLookup(value(values, mapping.experience), index::levelExists,
                "experience level", errors);
        String joined = trimToNull(value(values, mapping.joined()));
        if (joined != null && parseDate(joined) == null) {
            errors.add("joined date must be YYYY-MM-DD");
        }
        return errors;
    }

    private static void checkLookup(String raw, java.util.function.Predicate<String> exists,
                                    String label, List<String> errors) {
        String value = trimToNull(raw);
        if (value != null && !exists.test(value)) {
            errors.add(label + " '" + value + "' does not exist in this workspace");
        }
    }

    /** Resolves lookups lazily and caches, so validation is one query per value. */
    private final class LookupIndex {
        private final Long workspaceId;
        private final Map<String, Vertical> verticals = new HashMap<>();
        private final Map<String, RepStatus> statuses = new HashMap<>();
        private final Map<String, ExperienceLevel> levels = new HashMap<>();

        LookupIndex(Long workspaceId) {
            this.workspaceId = workspaceId;
        }

        private List<Vertical> verticalRows() {
            if (verticals.isEmpty()) {
                entityManager.createQuery(
                                "select v from Vertical v where v.workspaceId = :ws",
                                Vertical.class)
                        .setParameter("ws", workspaceId)
                        .getResultList()
                        .forEach(v -> verticals.put(v.getName().toLowerCase(Locale.ROOT), v));
            }
            return List.copyOf(verticals.values());
        }

        private List<RepStatus> statusRows() {
            if (statuses.isEmpty()) {
                entityManager.createQuery(
                                "select s from RepStatus s where s.workspaceId = :ws",
                                RepStatus.class)
                        .setParameter("ws", workspaceId)
                        .getResultList()
                        .forEach(s -> statuses.put(s.getName().toLowerCase(Locale.ROOT), s));
            }
            return List.copyOf(statuses.values());
        }

        private List<ExperienceLevel> levelRows() {
            if (levels.isEmpty()) {
                entityManager.createQuery(
                                "select e from ExperienceLevel e where e.workspaceId = :ws",
                                ExperienceLevel.class)
                        .setParameter("ws", workspaceId)
                        .getResultList()
                        .forEach(e -> levels.put(e.getName().toLowerCase(Locale.ROOT), e));
            }
            return List.copyOf(levels.values());
        }

        Vertical vertical(String name) {
            Vertical v = verticals.get(name.toLowerCase(Locale.ROOT));
            if (v == null) {
                throw new BadRequestException("Unknown vertical '" + name + "'");
            }
            return v;
        }

        RepStatus status(String name) {
            RepStatus s = statuses.get(name.toLowerCase(Locale.ROOT));
            if (s == null) {
                throw new BadRequestException("Unknown status '" + name + "'");
            }
            return s;
        }

        ExperienceLevel level(String name) {
            ExperienceLevel e = levels.get(name.toLowerCase(Locale.ROOT));
            if (e == null) {
                throw new BadRequestException("Unknown experience level '" + name + "'");
            }
            return e;
        }

        boolean verticalExists(String name) {
            verticalRows();
            return verticals.containsKey(name.toLowerCase(Locale.ROOT));
        }

        boolean statusExists(String name) {
            statusRows();
            return statuses.containsKey(name.toLowerCase(Locale.ROOT));
        }

        boolean levelExists(String name) {
            levelRows();
            return levels.containsKey(name.toLowerCase(Locale.ROOT));
        }
    }

    /** Guesses the mapping from header names; returns nulls for absent columns. */
    static Mapping suggestMapping(List<String> headers) {
        Map<String, String> byHeader = new LinkedHashMap<>();
        for (String header : headers) {
            byHeader.put(normalise(header), header);
        }
        return new Mapping(
                firstHeader(byHeader, "name", "rep name", "full name", "rep"),
                firstHeader(byHeader, "email", "e-mail", "mail"),
                firstHeader(byHeader, "discord", "discord user id", "discord id", "discord userid"),
                firstHeader(byHeader, "vertical", "team"),
                firstHeader(byHeader, "status", "rep status"),
                firstHeader(byHeader, "experience", "experience level", "level"),
                firstHeader(byHeader, "notes", "note"),
                firstHeader(byHeader, "joined", "joined date", "join date", "start date"));
    }

    private static String firstHeader(Map<String, String> byHeader, String... candidates) {
        for (String candidate : candidates) {
            String header = byHeader.get(candidate);
            if (header != null) {
                return header;
            }
        }
        return null;
    }

    private static String normalise(String header) {
        return header == null ? "" : header.trim().toLowerCase(Locale.ROOT).replace('_', ' ');
    }

    private static Map<String, String> rowValues(List<String> headers, String[] row) {
        Map<String, String> values = new LinkedHashMap<>();
        for (int i = 0; i < headers.size(); i++) {
            values.put(headers.get(i), i < row.length ? row[i] : null);
        }
        return values;
    }

    private static String value(Map<String, String> values, String header) {
        return header == null ? null : values.get(header);
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static java.time.LocalDate parseDate(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return java.time.LocalDate.parse(raw.trim());
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }

    /**
     * Minimal RFC-4180 CSV parser (quoted fields, "" escapes, CRLF/LF). No
     * external dependency; the import size is bounded by {@link #MAX_ROWS}.
     */
    static List<String[]> parse(String csv) {
        List<String[]> rows = new ArrayList<>();
        StringBuilder field = new StringBuilder();
        List<String> current = new ArrayList<>();
        boolean inQuotes = false;
        for (int i = 0; i < csv.length(); i++) {
            char c = csv.charAt(i);
            if (inQuotes) {
                if (c == '"') {
                    if (i + 1 < csv.length() && csv.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field.append(c);
                }
            } else if (c == '"') {
                inQuotes = true;
            } else if (c == ',') {
                current.add(field.toString());
                field.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < csv.length() && csv.charAt(i + 1) == '\n') {
                    i++;
                }
                current.add(field.toString());
                field.setLength(0);
                rows.add(current.toArray(new String[0]));
                current = new ArrayList<>();
            } else {
                field.append(c);
            }
        }
        if (field.length() > 0 || !current.isEmpty()) {
            current.add(field.toString());
            rows.add(current.toArray(new String[0]));
        }
        // Drop trailing blank lines.
        while (!rows.isEmpty()) {
            String[] last = rows.get(rows.size() - 1);
            boolean blank = true;
            for (String cell : last) {
                if (cell != null && !cell.isBlank()) {
                    blank = false;
                    break;
                }
            }
            if (!blank) {
                break;
            }
            rows.remove(rows.size() - 1);
        }
        return rows;
    }
}
