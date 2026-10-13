package com.coeso.roster.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Issues and verifies JWT access tokens. The token subject is the user id;
 * the workspace is deliberately NOT part of the token (it comes from the
 * X-Workspace header and is verified against memberships per request).
 */
@Component
public class JwtTokenProvider {

    private final SecretKey key;
    private final long ttlMinutes;

    public JwtTokenProvider(
            @Value("${app.jwt.secret}") String secret,
            @Value("${app.jwt.ttl-minutes:720}") long ttlMinutes) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) {
            throw new IllegalStateException(
                    "app.jwt.secret must be at least 32 characters (see .env.example)");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
        this.ttlMinutes = ttlMinutes;
    }

    public String createToken(Long userId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(userId))
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlMinutes * 60)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /** Returns the user id, or null when the token is invalid or expired. */
    public Long parseUserId(String token) {
        try {
            String subject = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload()
                    .getSubject();
            return subject == null ? null : Long.valueOf(subject);
        } catch (Exception e) {
            return null;
        }
    }
}
