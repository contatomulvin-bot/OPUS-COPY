import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";
import { CreditTransactionKind, Prisma, ReservationStatus, UserRole } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "./db.js";
import { analyzeTranscript } from "./ai.js";
import {
  allowRegistration,
  allowedOrigins,
  catalog,
  env,
  getCatalogItem,
  getCatalogItemByPriceId,
  superAdminEmails
} from "./config.js";
import { normalizeEmail } from "./security.js";
import {
  SupabaseAuthError,
  type SupabaseAuthUser,
  type SupabaseSessionResult,
  supabaseGetUser,
  supabaseRefresh,
  supabaseSignIn,
  supabaseSignOut,
  supabaseSignUp
} from "./supabase.js";
import {
  adminAdjustCredits,
  commitReservation,
  CreditError,
  grantCredits,
  quoteCredits,
  refundReservation,
  reserveCredits
} from "./credits.js";

type AuthContext = {
  userId: string;
  deviceId: string | null;
  role: UserRole;
  accessToken: string;
};

type AuthRequest = Request & {
  auth?: AuthContext;
};

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

function apiError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function customerIdFrom(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

function subscriptionIdFromInvoice(invoice: any): string | null {
  if (typeof invoice.subscription === "string") return invoice.subscription;
  const parentSub = invoice.parent?.subscription_details?.subscription;
  if (typeof parentSub === "string") return parentSub;
  if (parentSub && typeof parentSub.id === "string") return parentSub.id;
  return null;
}

function priceIdFromInvoice(invoice: any): string | null {
  const line = invoice.lines?.data?.[0];
  if (!line) return null;
  if (typeof line.price?.id === "string") return line.price.id;
  const modernPrice = line.pricing?.price_details?.price;
  if (typeof modernPrice === "string") return modernPrice;
  if (modernPrice && typeof modernPrice.id === "string") return modernPrice.id;
  return null;
}

function periodEndFromInvoice(invoice: any): Date | null {
  const end = invoice.lines?.data?.[0]?.period?.end;
  return typeof end === "number" ? new Date(end * 1000) : null;
}

function normalizedSubscriptionStatus(status: string | null | undefined): string {
  if (status === "active" || status === "trialing") return "ACTIVE";
  if (status === "past_due" || status === "unpaid") return "PAST_DUE";
  if (status === "canceled") return "CANCELED";
  return (status || "UNKNOWN").toUpperCase();
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  const alreadyProcessed = await prisma.webhookEvent.findUnique({
    where: { stripeEventId: event.id }
  });
  if (alreadyProcessed) return;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;
    const sku = session.metadata?.sku;
    const item = sku ? getCatalogItem(sku) : null;
    const customerId = customerIdFrom(session.customer);

    if (userId && customerId) {
      await prisma.user.updateMany({
        where: { id: userId },
        data: { stripeCustomerId: customerId }
      });
    }

    if (
      userId &&
      item &&
      item.mode === "payment" &&
      session.payment_status === "paid" &&
      item.credits > 0
    ) {
      await grantCredits({
        userId,
        amount: item.credits,
        kind: CreditTransactionKind.EXTRA_PURCHASE,
        description: "Compra de créditos " + item.sku,
        stripeEventId: event.id
      });
    }

    const subscriptionId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription && typeof session.subscription === "object"
          ? session.subscription.id
          : null;

    if (userId && item && item.mode === "subscription" && subscriptionId) {
      await prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscriptionId },
        create: {
          userId,
          stripeSubscriptionId: subscriptionId,
          sku: item.sku,
          status:
            session.payment_status === "paid" || session.payment_status === "no_payment_required"
              ? "ACTIVE"
              : "PENDING",
          creditsPerCycle: item.credits,
          unlimited: item.unlimited
        },
        update: {
          userId,
          sku: item.sku,
          creditsPerCycle: item.credits,
          unlimited: item.unlimited
        }
      });
    }
  }

  if (event.type === "invoice.paid") {
    const invoice = event.data.object as any;
    const customerId = customerIdFrom(invoice.customer);
    const user = customerId
      ? await prisma.user.findUnique({ where: { stripeCustomerId: customerId } })
      : null;
    const item = getCatalogItemByPriceId(priceIdFromInvoice(invoice));
    const subscriptionId = subscriptionIdFromInvoice(invoice);

    if (user && item && item.mode === "subscription" && subscriptionId) {
      await prisma.subscription.upsert({
        where: { stripeSubscriptionId: subscriptionId },
        create: {
          userId: user.id,
          stripeSubscriptionId: subscriptionId,
          sku: item.sku,
          status: "ACTIVE",
          creditsPerCycle: item.credits,
          unlimited: item.unlimited,
          currentPeriodEnd: periodEndFromInvoice(invoice)
        },
        update: {
          userId: user.id,
          sku: item.sku,
          status: "ACTIVE",
          creditsPerCycle: item.credits,
          unlimited: item.unlimited,
          currentPeriodEnd: periodEndFromInvoice(invoice)
        }
      });

      if (item.credits > 0) {
        await grantCredits({
          userId: user.id,
          amount: item.credits,
          kind: CreditTransactionKind.PLAN_GRANT,
          description: "Créditos mensais do plano " + item.sku,
          stripeEventId: event.id
        });
      }
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as any;
    const subscriptionId = subscriptionIdFromInvoice(invoice);
    if (subscriptionId) {
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionId },
        data: { status: "PAST_DUE" }
      });
    }
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as any;
    const priceId =
      subscription.items?.data?.[0]?.price?.id ||
      subscription.items?.data?.[0]?.pricing?.price_details?.price ||
      null;
    const item = getCatalogItemByPriceId(
      typeof priceId === "string" ? priceId : priceId?.id
    );
    const status =
      event.type === "customer.subscription.deleted"
        ? "CANCELED"
        : normalizedSubscriptionStatus(subscription.status);

    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status,
        ...(item
          ? {
              sku: item.sku,
              creditsPerCycle: item.credits,
              unlimited: item.unlimited
            }
          : {}),
        currentPeriodEnd:
          typeof subscription.current_period_end === "number"
            ? new Date(subscription.current_period_end * 1000)
            : undefined
      }
    });
  }

  try {
    await prisma.webhookEvent.create({
      data: { stripeEventId: event.id, type: event.type }
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return;
    }
    throw error;
  }
}

app.post(
  "/v1/stripe/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      return apiError(res, 503, "STRIPE_NOT_CONFIGURED", "Stripe não configurado.");
    }
    const signature = req.header("stripe-signature");
    if (!signature) {
      return apiError(res, 400, "MISSING_SIGNATURE", "Assinatura Stripe ausente.");
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );
      await processStripeEvent(event);
      return res.json({ received: true });
    } catch (error) {
      console.error("Stripe webhook error:", error);
      return apiError(res, 400, "INVALID_WEBHOOK", "Webhook inválido.");
    }
  }
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"]
  })
);

app.use(express.json({ limit: "8mb" }));

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: "draft-7",
  legacyHeaders: false
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

const aiLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

function supabaseDisplayName(user: SupabaseAuthUser): string | null {
  const metadata = user.user_metadata || {};
  for (const key of ["display_name", "full_name", "name"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 80);
    }
  }
  return null;
}

async function syncSupabaseUser(
  authUser: SupabaseAuthUser,
  preferredDisplayName?: string
) {
  const email = normalizeEmail(authUser.email || "");
  if (!email) {
    throw new SupabaseAuthError(401, "SUPABASE_EMAIL_REQUIRED", "A conta autenticada não possui e-mail.");
  }

  const [byId, byEmail] = await Promise.all([
    prisma.user.findUnique({ where: { id: authUser.id } }),
    prisma.user.findUnique({ where: { email } })
  ]);

  if (byEmail && byEmail.id !== authUser.id) {
    throw new SupabaseAuthError(
      409,
      "ACCOUNT_ID_CONFLICT",
      "Esta conta precisa ser migrada antes de entrar."
    );
  }

  const displayName =
    preferredDisplayName?.trim().slice(0, 80) ||
    byId?.displayName ||
    supabaseDisplayName(authUser);

  const role = superAdminEmails.has(email)
    ? UserRole.SUPER_ADMIN
    : byId?.role || UserRole.USER;

  return prisma.user.upsert({
    where: { id: authUser.id },
    create: {
      id: authUser.id,
      email,
      passwordHash: null,
      displayName,
      role,
      wallet: { create: {} }
    },
    update: {
      email,
      displayName,
      role
    }
  });
}

async function upsertDesktopDevice(
  userId: string,
  input: {
    deviceKey?: string;
    deviceName?: string;
    platform?: string;
  }
) {
  const deviceKey = input.deviceKey?.trim();
  if (!deviceKey) return null;

  return prisma.device.upsert({
    where: {
      userId_deviceKey: {
        userId,
        deviceKey
      }
    },
    create: {
      userId,
      deviceKey,
      name: (input.deviceName || "Windows PC").slice(0, 120),
      platform: (input.platform || "Windows").slice(0, 80)
    },
    update: {
      name: (input.deviceName || "Windows PC").slice(0, 120),
      platform: (input.platform || "Windows").slice(0, 80),
      lastSeenAt: new Date(),
      revokedAt: null
    }
  });
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return apiError(res, 401, "AUTH_REQUIRED", "Autenticação necessária.");
  }

  const accessToken = header.slice(7).trim();
  if (!accessToken) {
    return apiError(res, 401, "AUTH_REQUIRED", "Autenticação necessária.");
  }

  try {
    const authUser = await supabaseGetUser(accessToken);
    const user = await syncSupabaseUser(authUser);

    if (user.disabledAt) {
      return apiError(res, 403, "ACCOUNT_DISABLED", "Esta conta está desativada.");
    }

    let deviceId: string | null = null;
    const deviceKey = (req.header("x-mistcut-device-key") || "").trim();
    if (deviceKey && deviceKey.length >= 8 && deviceKey.length <= 200) {
      const device = await prisma.device.findUnique({
        where: {
          userId_deviceKey: {
            userId: user.id,
            deviceKey
          }
        }
      });
      if (device?.revokedAt) {
        return apiError(res, 401, "DEVICE_REVOKED", "Este dispositivo foi revogado.");
      }
      if (device) {
        deviceId = device.id;
        await prisma.device.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date() }
        });
      }
    }

    req.auth = {
      userId: user.id,
      deviceId,
      role: user.role,
      accessToken
    };
    return next();
  } catch (error) {
    if (error instanceof SupabaseAuthError) {
      const status = error.status >= 500 ? 502 : 401;
      return apiError(res, status, error.code, "Sessão expirada ou inválida.");
    }
    return next(error);
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.auth?.role;
  if (role !== UserRole.ADMIN && role !== UserRole.SUPER_ADMIN) {
    return apiError(res, 403, "ADMIN_REQUIRED", "Permissão administrativa necessária.");
  }
  return next();
}

const RegisterSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(1).max(80).optional(),
  deviceKey: z.string().min(8).max(200).optional(),
  deviceName: z.string().min(1).max(120).optional(),
  platform: z.string().min(1).max(80).optional()
});

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  deviceKey: z.string().min(8).max(200).optional(),
  deviceName: z.string().min(1).max(120).optional(),
  platform: z.string().min(1).max(80).optional()
});

async function authPayload(userId: string, session: SupabaseSessionResult) {
  const [user, wallet] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true
      }
    }),
    prisma.creditWallet.findUnique({ where: { userId } })
  ]);

  const accessExpiresAt = session.expiresAt
    ? new Date(session.expiresAt * 1000).toISOString()
    : session.expiresIn
      ? new Date(Date.now() + session.expiresIn * 1000).toISOString()
      : null;

  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    accessExpiresAt,
    user,
    credits: {
      balance: wallet?.balance || 0,
      reserved: wallet?.reserved || 0
    }
  };
}

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return res.json({
      status: "ok",
      service: "mistcut-cloud",
      auth: "supabase"
    });
  } catch {
    return apiError(res, 503, "DATABASE_UNAVAILABLE", "Banco indisponível.");
  }
});

app.post("/v1/auth/register", authLimiter, async (req, res) => {
  if (!allowRegistration) {
    return apiError(res, 403, "REGISTRATION_DISABLED", "Cadastro temporariamente desativado.");
  }

  const input = RegisterSchema.parse(req.body);
  const email = normalizeEmail(input.email);
  const session = await supabaseSignUp(email, input.password, input.displayName);

  if (!session.user) {
    return apiError(res, 502, "SUPABASE_USER_MISSING", "O provedor de autenticação não retornou o usuário.");
  }

  const user = await syncSupabaseUser(session.user, input.displayName);

  if (!session.accessToken || !session.refreshToken) {
    return res.status(202).json({
      requiresEmailConfirmation: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName
      }
    });
  }

  await upsertDesktopDevice(user.id, input);
  return res.status(201).json(await authPayload(user.id, session));
});

app.post("/v1/auth/login", authLimiter, async (req, res) => {
  const input = LoginSchema.parse(req.body);
  const email = normalizeEmail(input.email);
  const session = await supabaseSignIn(email, input.password);

  if (!session.user) {
    return apiError(res, 401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
  }

  const user = await syncSupabaseUser(session.user);
  if (user.disabledAt) {
    return apiError(res, 403, "ACCOUNT_DISABLED", "Esta conta está desativada.");
  }

  await upsertDesktopDevice(user.id, input);
  return res.json(await authPayload(user.id, session));
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20)
});

app.post("/v1/auth/refresh", authLimiter, async (req, res) => {
  const input = RefreshSchema.parse(req.body);
  const session = await supabaseRefresh(input.refreshToken);

  if (!session.user) {
    return apiError(res, 401, "REFRESH_INVALID", "Sessão não pode ser renovada.");
  }

  const user = await syncSupabaseUser(session.user);
  if (user.disabledAt) {
    return apiError(res, 403, "ACCOUNT_DISABLED", "Esta conta está desativada.");
  }

  const deviceKey = (req.header("x-mistcut-device-key") || "").trim();
  if (deviceKey) {
    const device = await prisma.device.findUnique({
      where: {
        userId_deviceKey: {
          userId: user.id,
          deviceKey
        }
      }
    });
    if (device?.revokedAt) {
      return apiError(res, 401, "DEVICE_REVOKED", "Este dispositivo foi revogado.");
    }
  }

  return res.json(await authPayload(user.id, session));
});

app.post("/v1/auth/logout", authMiddleware, async (req: AuthRequest, res) => {
  try {
    await supabaseSignOut(req.auth!.accessToken);
  } catch (error) {
    if (!(error instanceof SupabaseAuthError) || error.status >= 500) {
      throw error;
    }
  }
  return res.json({ success: true });
});

app.get("/v1/me", authMiddleware, async (req: AuthRequest, res) => {
  const [user, wallet, subscription] = await Promise.all([
    prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        createdAt: true
      }
    }),
    prisma.creditWallet.findUnique({ where: { userId: req.auth!.userId } }),
    prisma.subscription.findFirst({
      where: {
        userId: req.auth!.userId,
        status: "ACTIVE"
      },
      orderBy: { updatedAt: "desc" }
    })
  ]);

  return res.json({
    user,
    credits: {
      balance: wallet?.balance || 0,
      reserved: wallet?.reserved || 0
    },
    subscription
  });
});

app.get("/v1/devices", authMiddleware, async (req: AuthRequest, res) => {
  const devices = await prisma.device.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      name: true,
      platform: true,
      lastSeenAt: true,
      createdAt: true,
      revokedAt: true
    }
  });
  return res.json({ devices });
});

app.delete("/v1/devices/:id", authMiddleware, async (req: AuthRequest, res) => {
  const device = await prisma.device.findFirst({
    where: { id: String(req.params.id), userId: req.auth!.userId }
  });
  if (!device) return apiError(res, 404, "DEVICE_NOT_FOUND", "Dispositivo não encontrado.");

  await prisma.$transaction([
    prisma.device.update({
      where: { id: device.id },
      data: { revokedAt: new Date() }
    }),
    prisma.session.updateMany({
      where: { deviceId: device.id, revokedAt: null },
      data: { revokedAt: new Date() }
    })
  ]);

  return res.json({ success: true });
});

app.get("/v1/credits/balance", authMiddleware, async (req: AuthRequest, res) => {
  const quote = await quoteCredits(req.auth!.userId, "SHORT_AI", 1);
  return res.json({
    balance: quote.availableCredits,
    reserved: quote.reservedCredits,
    unlimited: quote.unlimited
  });
});

app.get("/v1/credits/quote", authMiddleware, async (req: AuthRequest, res) => {
  const actionCode = z.string().min(1).max(80).parse(req.query.actionCode || "SHORT_AI");
  const quantity = z.coerce.number().int().min(1).max(100).parse(req.query.quantity || 1);
  return res.json(await quoteCredits(req.auth!.userId, actionCode, quantity));
});

const AnalyzeSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  maxClips: z.number().int().min(1).max(20),
  segments: z.array(
    z.object({
      start: z.number().finite().min(0),
      end: z.number().finite().positive(),
      text: z.string().min(1).max(4000)
    }).refine(segment => segment.end > segment.start, {
      message: "O final do segmento deve ser maior que o início."
    })
  ).min(1).max(10000)
});

app.post(
  "/v1/ai/analyze",
  authMiddleware,
  aiLimiter,
  async (req: AuthRequest, res) => {
    const input = AnalyzeSchema.parse(req.body);
    const userId = req.auth!.userId;

    const metering = await reserveCredits({
      userId,
      deviceId: req.auth!.deviceId,
      actionCode: "SHORT_AI",
      quantity: input.maxClips,
      idempotencyKey: input.idempotencyKey,
      description: input.maxClips + " short(s) solicitados à IA do MISTCUT"
    });

    if (!metering.created) {
      const existing = metering.reservation;
      if (existing.status === ReservationStatus.COMMITTED && existing.resultJson) {
        const cached = JSON.parse(existing.resultJson);
        return res.json({
          ...cached,
          cached: true,
          credits: {
            balance: metering.wallet?.balance || 0,
            reserved: metering.wallet?.reserved || 0
          }
        });
      }
      if (existing.status === ReservationStatus.REFUNDED) {
        return apiError(
          res,
          409,
          "AI_ATTEMPT_FAILED",
          "Esta tentativa já falhou e foi reembolsada. Inicie uma nova tentativa."
        );
      }
      return apiError(
        res,
        409,
        "AI_ANALYSIS_IN_PROGRESS",
        "Esta análise já está sendo processada."
      );
    }

    try {
      const clips = await analyzeTranscript(input.segments, input.maxClips);
      const resultJson = JSON.stringify({ clips });
      const settled = await commitReservation(
        userId,
        metering.reservation.id,
        clips.length,
        resultJson
      );

      return res.json({
        clips,
        cached: false,
        credits: {
          balance: settled.wallet?.balance || 0,
          reserved: settled.wallet?.reserved || 0
        },
        metering: {
          requestedClips: input.maxClips,
          deliveredClips: clips.length,
          chargedCredits: settled.reservation.settledAmount ?? settled.reservation.amount
        }
      });
    } catch (error) {
      try {
        await refundReservation(
          userId,
          metering.reservation.id,
          "Falha confirmada pelo MISTCUT Cloud durante análise de IA"
        );
        await prisma.creditReservation.update({
          where: { id: metering.reservation.id },
          data: {
            failureCode: error instanceof Error
              ? error.name.slice(0, 100)
              : "AI_ANALYSIS_FAILED"
          }
        });
      } catch (refundError) {
        console.error("Falha ao reembolsar análise de IA:", refundError);
      }
      throw error;
    }
  }
);

app.get("/v1/credits/history", authMiddleware, async (req: AuthRequest, res) => {
  const limit = z.coerce.number().int().min(1).max(100).parse(req.query.limit || 50);
  const transactions = await prisma.creditTransaction.findMany({
    where: { userId: req.auth!.userId },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return res.json({ transactions });
});

const CheckoutSchema = z.object({
  sku: z.enum([
    "STANDARD",
    "PRO",
    "PRO_STUDIO",
    "AGENCY",
    "EXTRA_2000",
    "EXTRA_5000",
    "EXTRA_10000"
  ])
});

app.post("/v1/billing/checkout", authMiddleware, async (req: AuthRequest, res) => {
  if (!stripe) {
    return apiError(res, 503, "STRIPE_NOT_CONFIGURED", "Stripe não configurado.");
  }

  const input = CheckoutSchema.parse(req.body);
  const item = getCatalogItem(input.sku);
  if (!item || !item.priceId) {
    return apiError(res, 503, "PRICE_NOT_CONFIGURED", "Preço ainda não configurado.");
  }

  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user) return apiError(res, 404, "USER_NOT_FOUND", "Usuário não encontrado.");

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.displayName || undefined,
      metadata: { userId: user.id }
    });
    customerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId }
    });
  }

  const metadata = {
    userId: user.id,
    sku: item.sku
  };

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: item.mode,
    line_items: [{ price: item.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url:
      env.WEB_URL + "/dashboard/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
    cancel_url: env.WEB_URL + "/dashboard/billing?checkout=cancelled",
    metadata,
    ...(item.mode === "subscription"
      ? { subscription_data: { metadata } }
      : { payment_intent_data: { metadata } })
  });

  return res.json({ url: session.url });
});

app.post("/v1/billing/portal", authMiddleware, async (req: AuthRequest, res) => {
  if (!stripe) {
    return apiError(res, 503, "STRIPE_NOT_CONFIGURED", "Stripe não configurado.");
  }
  const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
  if (!user?.stripeCustomerId) {
    return apiError(res, 400, "NO_BILLING_ACCOUNT", "Conta de cobrança ainda não criada.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: env.WEB_URL + "/dashboard/billing"
  });
  return res.json({ url: session.url });
});

const AdminCreditSchema = z.object({
  amount: z.number().int().min(-1000000).max(1000000).refine(value => value !== 0),
  reason: z.string().trim().min(3).max(300)
});

app.post(
  "/v1/admin/users/:userId/credits",
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const input = AdminCreditSchema.parse(req.body);
    const target = await prisma.user.findUnique({ where: { id: String(req.params.userId) } });
    if (!target) return apiError(res, 404, "USER_NOT_FOUND", "Usuário não encontrado.");

    const result = await adminAdjustCredits({
      adminId: req.auth!.userId,
      userId: target.id,
      amount: input.amount,
      reason: input.reason,
      ip: req.ip,
      userAgent: req.header("user-agent")
    });

    return res.json({
      transaction: result.transaction,
      credits: {
        balance: result.wallet.balance,
        reserved: result.wallet.reserved
      }
    });
  }
);

app.get(
  "/v1/admin/users",
  authMiddleware,
  requireAdmin,
  async (req: AuthRequest, res) => {
    const email = typeof req.query.email === "string" ? normalizeEmail(req.query.email) : "";
    const users = await prisma.user.findMany({
      where: email ? { email: { contains: email, mode: "insensitive" } } : {},
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        disabledAt: true,
        createdAt: true,
        wallet: true,
        subscriptions: {
          orderBy: { updatedAt: "desc" },
          take: 1
        }
      }
    });
    return res.json({ users });
  }
);

app.get("/v1/app/version", (_req, res) => {
  return res.json({
    latest: env.APP_LATEST_VERSION,
    minimum: env.APP_MINIMUM_VERSION,
    downloadUrl: env.APP_DOWNLOAD_URL || null
  });
});

app.get("/v1/catalog", (_req, res) => {
  return res.json({
    plans: Object.values(catalog).map(item => ({
      sku: item.sku,
      mode: item.mode,
      credits: item.credits,
      unlimited: item.unlimited,
      configured: Boolean(item.priceId)
    }))
  });
});

app.use((_req, res) => {
  return apiError(res, 404, "NOT_FOUND", "Rota não encontrada.");
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Dados inválidos.",
        details: error.issues
      }
    });
  }

  if (error instanceof CreditError) {
    const status = error.code === "INSUFFICIENT_CREDITS" ? 402 : 400;
    return apiError(res, status, error.code, error.message);
  }

  if (error instanceof SupabaseAuthError) {
    const status = error.status >= 500 ? 502 : error.status;
    return apiError(res, status, error.code, error.message);
  }

  console.error(error);
  return apiError(res, 500, "INTERNAL_ERROR", "Erro interno do servidor.");
});

async function start() {
  await prisma.creditAction.upsert({
    where: { code: "SHORT_AI" },
    create: {
      code: "SHORT_AI",
      label: "Short gerado por IA",
      unitCost: 100,
      enabled: true
    },
    update: {}
  });

  app.listen(env.PORT, "0.0.0.0", () => {
    console.log("MISTCUT Cloud listening on port " + env.PORT);
  });
}

start().catch(error => {
  console.error("MISTCUT Cloud failed to start:", error);
  process.exit(1);
});
