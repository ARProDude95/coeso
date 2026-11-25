import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Thrown by guards and handlers; converted to a JSON body by `runApi`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function bodyFor(error: unknown): { status: number; payload: unknown } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      payload: { error: error.message, code: error.code ?? "error" },
    };
  }
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      status: 400,
      payload: { error: "Validation failed", code: "invalid_input", fieldErrors },
    };
  }
  console.error("[api] unhandled error:", error);
  return {
    status: 500,
    payload: { error: "Internal server error", code: "internal" },
  };
}

/**
 * Wraps a route handler so every thrown error becomes a consistent JSON
 * response, and unexpected errors never leak a stack trace to the client.
 */
export function runApi(
  fn: () => Promise<Response>,
): Promise<Response> {
  return fn().catch((error: unknown) => {
    const { status, payload } = bodyFor(error);
    return NextResponse.json(payload, { status });
  });
}

export function ok(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function created(data: unknown): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

/** Reads and parses a JSON body, letting Zod errors surface as 400s. */
export async function readJson(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ApiError(400, "Unable to read request body", "bad_body");
  }
  if (!text) throw new ApiError(400, "Request body is required", "bad_body");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Body must be valid JSON", "bad_json");
  }
}
