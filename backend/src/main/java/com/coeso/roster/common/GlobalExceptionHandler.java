package com.coeso.roster.common;

import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** Maps application exceptions to a consistent JSON error envelope. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    public record ErrorBody(int status, String code, String message, Map<String, Object> details) {

        public static ErrorBody of(int status, String code, String message) {
            return new ErrorBody(status, code, message, null);
        }
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorBody> notFound(NotFoundException e) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", e.getMessage());
    }

    /** Unmatched URL/path (e.g. probing a route that does not exist). */
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<ErrorBody> noResource(
            org.springframework.web.servlet.resource.NoResourceFoundException e) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "No such endpoint");
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ErrorBody> badRequest(BadRequestException e) {
        return body(HttpStatus.BAD_REQUEST, "BAD_REQUEST", e.getMessage());
    }

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ErrorBody> forbidden(ForbiddenException e) {
        return body(HttpStatus.FORBIDDEN, "FORBIDDEN", e.getMessage());
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ErrorBody> unauthorized(UnauthorizedException e) {
        return body(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", e.getMessage());
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ErrorBody> conflict(ConflictException e) {
        return body(HttpStatus.CONFLICT, "CONFLICT", e.getMessage());
    }

    @ExceptionHandler(com.coeso.roster.billing.BillingSignatureException.class)
    public ResponseEntity<ErrorBody> billingSignature(
            com.coeso.roster.billing.BillingSignatureException e) {
        return body(HttpStatus.UNAUTHORIZED, "BILLING_SIGNATURE_INVALID", e.getMessage());
    }

    @ExceptionHandler(com.coeso.roster.billing.BillingUnavailableException.class)
    public ResponseEntity<ErrorBody> billingUnavailable(
            com.coeso.roster.billing.BillingUnavailableException e) {
        return body(HttpStatus.SERVICE_UNAVAILABLE, "BILLING_NOT_CONFIGURED", e.getMessage());
    }

    @ExceptionHandler(com.coeso.roster.discord.DiscordUnavailableException.class)
    public ResponseEntity<ErrorBody> discordUnavailable(
            com.coeso.roster.discord.DiscordUnavailableException e) {
        return body(HttpStatus.SERVICE_UNAVAILABLE, "DISCORD_NOT_CONFIGURED", e.getMessage());
    }

    @ExceptionHandler(PlanLimitException.class)
    public ResponseEntity<ErrorBody> planLimit(PlanLimitException e) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("resource", e.getResource());
        details.put("current", e.getCurrent());
        details.put("limit", e.getLimit());
        return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED)
                .body(new ErrorBody(402, "PLAN_LIMIT_EXCEEDED", e.getMessage(), details));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorBody> validation(MethodArgumentNotValidException e) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldError fe : e.getBindingResult().getFieldErrors()) {
            fields.put(fe.getField(), fe.getDefaultMessage());
        }
        return ResponseEntity.badRequest()
                .body(new ErrorBody(400, "VALIDATION_ERROR", "Request validation failed", fields));
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ErrorBody> constraint(ConstraintViolationException e) {
        return body(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", e.getMessage());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorBody> unreadable(HttpMessageNotReadableException e) {
        return body(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Malformed request body");
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorBody> typeMismatch(MethodArgumentTypeMismatchException e) {
        return body(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "Invalid parameter: " + e.getName());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorBody> accessDenied(AccessDeniedException e) {
        return body(HttpStatus.FORBIDDEN, "FORBIDDEN", "Insufficient role for this operation");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorBody> dataIntegrity(DataIntegrityViolationException e) {
        return conflictFromCause(String.valueOf(e.getMostSpecificCause().getMessage()));
    }

    /**
     * Raw Hibernate constraint failures surface un-translated when they happen
     * inside the tenant transaction template (no @Repository proxy in between),
     * so map them to the same 409 envelope instead of falling through to 500.
     */
    @ExceptionHandler(org.hibernate.exception.ConstraintViolationException.class)
    public ResponseEntity<ErrorBody> hibernateConstraint(
            org.hibernate.exception.ConstraintViolationException e) {
        return conflictFromCause(String.valueOf(e.getMessage()));
    }

    private ResponseEntity<ErrorBody> conflictFromCause(String cause) {
        String message = "Data integrity violation";
        if (cause.contains("uq_placements_ws_active_rep")) {
            message = "Rep already has an active placement";
        } else if (cause.contains("uq_workspaces_slug")) {
            message = "Workspace slug is already taken";
        } else if (cause.contains("_ws_name")) {
            message = "That name is already used in this workspace";
        } else if (cause.toLowerCase().contains("duplicate")) {
            message = "Duplicate value violates a uniqueness constraint";
        } else if (cause.toLowerCase().contains("foreign key")) {
            message = "Related record is missing or belongs to another workspace";
        }
        return body(HttpStatus.CONFLICT, "CONFLICT", message);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorBody> unexpected(Exception e) {
        log.error("Unhandled exception", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Unexpected server error");
    }

    private ResponseEntity<ErrorBody> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(new ErrorBody(status.value(), code, message, null));
    }
}
