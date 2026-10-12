import { z } from "zod";
import { auth, passwordLength } from "./auth";
import { db } from "./db";

export class AdminExistsError extends Error {
  constructor() {
    super("An admin already exists. Use --force to create another one.");
  }
}

const Input = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z
    .string()
    .min(passwordLength.min, {
      error: `The password needs at least ${passwordLength.min} characters.`,
    })
    .max(passwordLength.max, {
      error: `The password can have at most ${passwordLength.max} characters.`,
    }),
  force: z.boolean().default(false),
});

// Bootstraps an admin account from the server (SPEC-identity I1). Public sign-up is disabled,
// so this is the only way in until invites exist.
export async function createAdmin(input: z.input<typeof Input>): Promise<{ userId: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join(" "));
  const { email, password, force } = parsed.data;

  if (!force) {
    const admin = await db().query.users.findFirst({
      columns: { id: true },
      where: (users, { eq }) => eq(users.role, "admin"),
    });
    if (admin) throw new AdminExistsError();
  }

  // Without request headers the admin plugin skips its session check: this is a server call.
  const { user } = await auth().api.createUser({
    body: { email, password, name: email.split("@")[0]!, role: "admin" },
  });
  return { userId: user.id };
}
