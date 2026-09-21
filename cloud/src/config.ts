import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4100),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  ALLOW_REGISTRATION: z.string().default("true"),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.5-flash,gemini-3.5-flash-lite"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_STANDARD: z.string().default(""),
  STRIPE_PRICE_PRO: z.string().default(""),
  STRIPE_PRICE_PRO_STUDIO: z.string().default(""),
  STRIPE_PRICE_AGENCY: z.string().default(""),
  STRIPE_PRICE_EXTRA_2000: z.string().default(""),
  STRIPE_PRICE_EXTRA_5000: z.string().default(""),
  STRIPE_PRICE_EXTRA_10000: z.string().default(""),
  ACCESS_TOKEN_MINUTES: z.coerce.number().int().min(5).max(120).default(15),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  APP_LATEST_VERSION: z.string().default("4.7.1"),
  APP_MINIMUM_VERSION: z.string().default("4.7.1"),
  APP_DOWNLOAD_URL: z.string().default("")
});

export const env = EnvSchema.parse(process.env);

export const allowedOrigins = env.CORS_ORIGINS
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

export const allowRegistration = env.ALLOW_REGISTRATION.toLowerCase() === "true";

export type CatalogSku =
  | "STANDARD"
  | "PRO"
  | "PRO_STUDIO"
  | "AGENCY"
  | "EXTRA_2000"
  | "EXTRA_5000"
  | "EXTRA_10000";

export type CatalogItem = {
  sku: CatalogSku;
  mode: "subscription" | "payment";
  credits: number;
  unlimited: boolean;
  priceId: string;
};

export const catalog: Record<CatalogSku, CatalogItem> = {
  STANDARD: {
    sku: "STANDARD",
    mode: "subscription",
    credits: 2000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_STANDARD
  },
  PRO: {
    sku: "PRO",
    mode: "subscription",
    credits: 5000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_PRO
  },
  PRO_STUDIO: {
    sku: "PRO_STUDIO",
    mode: "subscription",
    credits: 10000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_PRO_STUDIO
  },
  AGENCY: {
    sku: "AGENCY",
    mode: "subscription",
    credits: 0,
    unlimited: true,
    priceId: env.STRIPE_PRICE_AGENCY
  },
  EXTRA_2000: {
    sku: "EXTRA_2000",
    mode: "payment",
    credits: 2000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_EXTRA_2000
  },
  EXTRA_5000: {
    sku: "EXTRA_5000",
    mode: "payment",
    credits: 5000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_EXTRA_5000
  },
  EXTRA_10000: {
    sku: "EXTRA_10000",
    mode: "payment",
    credits: 10000,
    unlimited: false,
    priceId: env.STRIPE_PRICE_EXTRA_10000
  }
};

export function getCatalogItem(sku: string): CatalogItem | null {
  return Object.prototype.hasOwnProperty.call(catalog, sku)
    ? catalog[sku as CatalogSku]
    : null;
}

export function getCatalogItemByPriceId(priceId: string | null | undefined): CatalogItem | null {
  if (!priceId) return null;
  return Object.values(catalog).find(item => item.priceId && item.priceId === priceId) || null;
}
