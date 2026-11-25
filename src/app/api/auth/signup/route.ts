import { NextRequest } from "next/server";
import { ApiError, created, readJson, runApi } from "@/lib/api";
import { createSession } from "@/lib/session";
import { createUser } from "@/lib/users";
import { hashPassword } from "@/lib/password";
import { signupSchema } from "@/lib/validation";

/**
 * Creates an account. The first account on a fresh deployment becomes the
 * admin; every later account is a member. Input is validated server-side and
 * the password is hashed before it touches the database.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const input = signupSchema.parse(await readJson(request));
    const passwordHash = await hashPassword(input.password);

    let user;
    try {
      user = await createUser({
        email: input.email,
        name: input.name,
        passwordHash,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "EMAIL_TAKEN") {
        throw new ApiError(
          409,
          "An account with that email already exists",
          "email_taken",
        );
      }
      throw error;
    }

    await createSession(user.id);
    return created({
      ok: true,
      user: { id: user.id, name: user.name, isAdmin: user.is_admin === 1 },
    });
  });
}
