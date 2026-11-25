import { NextRequest } from "next/server";
import { ApiError, ok, readJson, runApi } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { getUserByEmail } from "@/lib/users";
import { loginSchema } from "@/lib/validation";

/**
 * Signs in with email + password. Unknown email and wrong password return the
 * same generic 401 so the endpoint can't be used to enumerate accounts.
 */
export async function POST(request: NextRequest) {
  return runApi(async () => {
    const input = loginSchema.parse(await readJson(request));
    const user = await getUserByEmail(input.email);

    if (!user) {
      // Spend roughly the same time as a real check before failing.
      await hashPassword(input.password);
      throw new ApiError(401, "Incorrect email or password", "invalid_login");
    }

    const valid = await verifyPassword(input.password, user.password_hash);
    if (!valid) {
      throw new ApiError(401, "Incorrect email or password", "invalid_login");
    }

    await createSession(user.id);
    return ok({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        isAdmin: user.is_admin === 1,
      },
    });
  });
}
