package com.coeso.roster.workspace;

import com.coeso.roster.common.BadRequestException;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Workspace slug helpers: derivation, pattern and reserved words. */
public final class Slugs {

    public static final Set<String> RESERVED = Set.of("www", "app", "api", "admin");

    private static final Pattern VALID = Pattern.compile("[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?");

    private Slugs() {
    }

    /** Derives a slug from a display name, or returns an empty string when impossible. */
    public static String slugify(String name) {
        String slug = name.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+|-+$)", "");
        return slug.length() > 63 ? slug.substring(0, 63).replaceAll("-+$", "") : slug;
    }

    public static void validate(String slug) {
        if (slug == null || !VALID.matcher(slug).matches()) {
            throw new BadRequestException(
                    "Slug must be 1-63 characters of lowercase letters, digits or hyphens "
                            + "and start/end with a letter or digit");
        }
        if (RESERVED.contains(slug)) {
            throw new BadRequestException("Slug '" + slug + "' is reserved");
        }
    }
}
