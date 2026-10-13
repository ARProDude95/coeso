package com.coeso.roster.auth;

/** Principal placed in the SecurityContext by the JWT filter. */
public record UserPrincipal(Long id) {
}
