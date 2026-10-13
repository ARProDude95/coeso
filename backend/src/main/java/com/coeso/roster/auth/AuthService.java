package com.coeso.roster.auth;

import com.coeso.roster.common.ConflictException;
import com.coeso.roster.common.UnauthorizedException;
import com.coeso.roster.entity.User;
import com.coeso.roster.repo.Repositories.UserRepository;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * Authentication: registration creates a user only (workspace creation is a
 * separate authenticated call), login returns a JWT. Passwords are BCrypt
 * hashed; raw passwords never leave this service.
 */
@Service
public class AuthService {

    public record RegisterRequest(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 8, max = 72) String password,
            @NotBlank @Size(max = 120) String displayName) {
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password) {
    }

    public record UserResponse(Long id, String email, String displayName) {
    }

    public record AuthResponse(String token, UserResponse user) {
    }

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    public AuthService(UserRepository users, PasswordEncoder passwordEncoder,
                       JwtTokenProvider jwtTokenProvider) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
    }

    public AuthResponse register(RegisterRequest request) {
        String email = normalizeEmail(request.email());
        if (users.findByEmail(email).isPresent()) {
            throw new ConflictException("An account with this email already exists");
        }
        User user = new User();
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setDisplayName(request.displayName().trim());
        users.save(user);
        return new AuthResponse(jwtTokenProvider.createToken(user.getId()), toResponse(user));
    }

    public AuthResponse login(LoginRequest request) {
        String email = normalizeEmail(request.email());
        User user = users.findByEmail(email).orElse(null);
        if (user == null || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new UnauthorizedException("Invalid email or password");
        }
        return new AuthResponse(jwtTokenProvider.createToken(user.getId()), toResponse(user));
    }

    public UserResponse me() {
        User user = users.findById(CurrentUser.id())
                .orElseThrow(() -> new UnauthorizedException("Account no longer exists"));
        return toResponse(user);
    }

    private static String normalizeEmail(String email) {
        return email.trim().toLowerCase();
    }

    private static UserResponse toResponse(User user) {
        return new UserResponse(user.getId(), user.getEmail(), user.getDisplayName());
    }
}
