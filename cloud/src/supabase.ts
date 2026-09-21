import { env } from "./config.js";

export type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type SupabaseSessionResult = {
  user: SupabaseAuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  expiresAt: number | null;
};

export class SupabaseAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "SupabaseAuthError";
    this.status = status;
    this.code = code;
  }
}

function authUrl(path: string): string {
  return env.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1" + path;
}

async function authRequest(
  path: string,
  init: RequestInit,
  accessToken?: string
): Promise<any> {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.SUPABASE_PUBLISHABLE_KEY);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (accessToken) {
    headers.set("Authorization", "Bearer " + accessToken);
  }

  const response = await fetch(authUrl(path), {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000)
  });

  const raw = await response.text();
  let payload: any = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw };
    }
  }

  if (!response.ok) {
    const code = String(
      payload?.code ||
      payload?.error_code ||
      payload?.error ||
      "SUPABASE_AUTH_ERROR"
    );
    const message = String(
      payload?.msg ||
      payload?.message ||
      payload?.error_description ||
      "Falha na autenticação."
    );
    throw new SupabaseAuthError(response.status, code, message);
  }

  return payload;
}

function normalizeSession(payload: any): SupabaseSessionResult {
  const session = payload?.session && typeof payload.session === "object"
    ? payload.session
    : payload;

  const user =
    (payload?.user && typeof payload.user === "object" ? payload.user : null) ||
    (session?.user && typeof session.user === "object" ? session.user : null);

  const accessToken =
    typeof session?.access_token === "string" ? session.access_token : null;
  const refreshToken =
    typeof session?.refresh_token === "string" ? session.refresh_token : null;
  const expiresIn =
    typeof session?.expires_in === "number" ? session.expires_in : null;
  const expiresAt =
    typeof session?.expires_at === "number" ? session.expires_at : null;

  return { user, accessToken, refreshToken, expiresIn, expiresAt };
}

export async function supabaseSignUp(
  email: string,
  password: string,
  displayName?: string
): Promise<SupabaseSessionResult> {
  const payload = await authRequest("/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: displayName ? { display_name: displayName } : {}
    })
  });
  return normalizeSession(payload);
}

export async function supabaseSignIn(
  email: string,
  password: string
): Promise<SupabaseSessionResult> {
  const payload = await authRequest("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  const result = normalizeSession(payload);
  if (!result.user || !result.accessToken || !result.refreshToken) {
    throw new SupabaseAuthError(502, "INVALID_SUPABASE_SESSION", "O Supabase retornou uma sessão incompleta.");
  }
  return result;
}

export async function supabaseRefresh(
  refreshToken: string
): Promise<SupabaseSessionResult> {
  const payload = await authRequest("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  const result = normalizeSession(payload);
  if (!result.user || !result.accessToken || !result.refreshToken) {
    throw new SupabaseAuthError(502, "INVALID_SUPABASE_SESSION", "O Supabase retornou uma sessão incompleta.");
  }
  return result;
}

export async function supabaseGetUser(accessToken: string): Promise<SupabaseAuthUser> {
  const payload = await authRequest("/user", { method: "GET" }, accessToken);
  if (!payload || typeof payload.id !== "string") {
    throw new SupabaseAuthError(401, "INVALID_SUPABASE_USER", "Sessão inválida.");
  }
  return payload as SupabaseAuthUser;
}

export async function supabaseSignOut(accessToken: string): Promise<void> {
  await authRequest("/logout", { method: "POST" }, accessToken);
}
