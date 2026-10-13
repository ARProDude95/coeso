package com.coeso.roster.common;

/** 401: bad credentials or missing/invalid token. */
public class UnauthorizedException extends RuntimeException {
    public UnauthorizedException(String message) {
        super(message);
    }
}
