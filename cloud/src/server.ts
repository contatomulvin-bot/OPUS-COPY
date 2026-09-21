import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";
import { CreditTransactionKind, Prisma, UserRole } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "./db.js";
import {
  allowRegistration,
  allowedOrigins,
  catalog,
  env,
  getCatalogItem,
  getCatalogItemByPriceId
} from "./config.js";
import {
  hashPassword,
  hashToken,
  normalizeEmail,
  randomToken,
  verifyPassword
} from "./security.js";
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
  sessionId: string;
  deviceId: string | null;
  role: UserRole;
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

app.use(express.json({ limit: "1mb" }));

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

async function issueSession(userId: string, deviceId: string | null) {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const now = Date.now();
  const accessExpiresAt = new Date(now + env.ACCESS_TOKEN_MINUTES * 60_000);
  const refreshExpiresAt = new Date(now + env.REFRESH_TOKEN_DAYS * 86_400_000);

  const session = await prisma.session.create({
    data: {
      userId,
      deviceId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt
    }
  });

  return {
    sessionId: session.id,
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt
  };
}

async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return apiError(res, 401, "AUTH_REQUIRED", "Autenticação necessária.");
  }

  const token = header.slice(7).trim();
  const session = await prisma.session.findUnique({
    where: { accessTokenHash: hashToken(token) },
    include: { user: true, device: true }
  });

  if (
    !session ||
    session.revokedAt ||
    session.accessExpiresAt <= new Date() ||
    session.user.disabledAt ||
    session.device?.revokedAt
  ) {
    return apiError(res, 401, "SESSION_INVALID", "Sessão expirada ou inválida.");
  }

  req.auth = {
    userId: session.userId,
    sessionId: session.id,
    deviceId: session.deviceId,
    role: session.user.role
  };

  await Promise.all([
    prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() }
    }),
    session.deviceId
      ? prisma.device.update({
          where: { id: session.deviceId },
          data: { lastSeenAt: new Date() }
        })
      : Promise.resolve()
  ]);

  return next();
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
  deviceKey: z.string().min(8).max(200),
  deviceName: z.string().min(1).max(120),
  platform: z.string().min(1).max(80).default("Windows")
});

const LoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  deviceKey: z.string().min(8).max(200),
  deviceName: z.string().min(1).max(120),
  platform: z.string().min(1).max(80).default("Windows")
});

async function authPayload(userId: string, sessionTokens: Awaited<ReturnType<typeof issueSession>>) {
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

  return {
    ...sessionTokens,
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
    return res.json({ status: "ok", service: "mistcut-cloud" });
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
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return apiError(res, 409, "EMAIL_IN_USE", "Este e-mail já está cadastrado.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: input.displayName,
      wallet: { create: {} }
    }
  });

  const device = await prisma.device.create({
    data: {
      userId: user.id,
      deviceKey: input.deviceKey,
      name: input.deviceName,
      platform: input.platform
    }
  });

  const tokens = await issueSession(user.id, device.id);
  return res.status(201).json(await authPayload(user.id, tokens));
});

app.post("/v1/auth/login", authLimiter, async (req, res) => {
  const input = LoginSchema.parse(req.body);
  const email = normalizeEmail(input.email);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.disabledAt || !(await verifyPassword(input.password, user.passwordHash))) {
    return apiError(res, 401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
  }

  const device = await prisma.device.upsert({
    where: {
      userId_deviceKey: {
        userId: user.id,
        deviceKey: input.deviceKey
      }
    },
    create: {
      userId: user.id,
      deviceKey: input.deviceKey,
      name: input.deviceName,
      platform: input.platform
    },
    update: {
      name: input.deviceName,
      platform: input.platform,
      lastSeenAt: new Date(),
      revokedAt: null
    }
  });

  const tokens = await issueSession(user.id, device.id);
  return res.json(await authPayload(user.id, tokens));
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20)
});

app.post("/v1/auth/refresh", authLimiter, async (req, res) => {
  const input = RefreshSchema.parse(req.body);
  const oldSession = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(input.refreshToken) },
    include: { user: true, device: true }
  });

  if (
    !oldSession ||
    oldSession.revokedAt ||
    oldSession.refreshExpiresAt <= new Date() ||
    oldSession.user.disabledAt ||
    oldSession.device?.revokedAt
  ) {
    return apiError(res, 401, "REFRESH_INVALID", "Sessão não pode ser renovada.");
  }

  const accessToken = randomToken(32);
  const refreshToken = randomToken(48);
  const now = Date.now();
  const accessExpiresAt = new Date(now + env.ACCESS_TOKEN_MINUTES * 60_000);
  const refreshExpiresAt = new Date(now + env.REFRESH_TOKEN_DAYS * 86_400_000);

  await prisma.session.update({
    where: { id: oldSession.id },
    data: {
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
      lastSeenAt: new Date()
    }
  });

  return res.json(
    await authPayload(oldSession.userId, {
      sessionId: oldSession.id,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt
    })
  );
});

app.post("/v1/auth/logout", authMiddleware, async (req: AuthRequest, res) => {
  await prisma.session.update({
    where: { id: req.auth!.sessionId },
    data: { revokedAt: new Date() }
  });
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
    where: { id: req.params.id, userId: req.auth!.userId }
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

const ReserveSchema = z.object({
  actionCode: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(100),
  idempotencyKey: z.string().min(8).max(200),
  description: z.string().max(300).optional()
});

app.post("/v1/credits/reservations", authMiddleware, async (req: AuthRequest, res) => {
  const input = ReserveSchema.parse(req.body);
  const result = await reserveCredits({
    userId: req.auth!.userId,
    deviceId: req.auth!.deviceId,
    ...input
  });
  return res.status(201).json({
    reservation: result.reservation,
    credits: {
      balance: result.wallet?.balance || 0,
      reserved: result.wallet?.reserved || 0
    }
  });
});

app.post(
  "/v1/credits/reservations/:id/commit",
  authMiddleware,
  async (req: AuthRequest, res) => {
    const actualQuantity =
      req.body?.actualQuantity === undefined
        ? undefined
        : z.number().int().min(0).max(100).parse(req.body.actualQuantity);
    const result = await commitReservation(
      req.auth!.userId,
      req.params.id,
      actualQuantity
    );
    return res.json({
      reservation: result.reservation,
      credits: {
        balance: result.wallet?.balance || 0,
        reserved: result.wallet?.reserved || 0
      }
    });
  }
);

app.post(
  "/v1/credits/reservations/:id/refund",
  authMiddleware,
  async (req: AuthRequest, res) => {
    const description =
      typeof req.body?.description === "string" ? req.body.description.slice(0, 300) : undefined;
    const result = await refundReservation(
      req.auth!.userId,
      req.params.id,
      description
    );
    return res.json({
      reservation: result.reservation,
      credits: {
        balance: result.wallet?.balance || 0,
        reserved: result.wallet?.reserved || 0
      }
    });
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
    const target = await prisma.user.findUnique({ where: { id: req.params.userId } });
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
