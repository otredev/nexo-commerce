import { z } from "zod";
import { ROLES } from "./roles";

const email = z.string().trim().toLowerCase().email("Correo no válido").max(254);
const password = z
  .string()
  .min(10, "Usa al menos 10 caracteres")
  .max(128, "Máximo 128 caracteres");
const name = z.string().trim().min(1, "Requerido").max(120);

export const registerSchema = z.object({
  businessName: name,
  ownerName: name,
  email,
  password,
  currency: z.string().length(3).toUpperCase().default("MXN"),
  timezone: z.string().min(1).max(64).default("America/Mexico_City"),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Requerido").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password,
});

export const businessSettingsSchema = z.object({
  tradeName: name,
  legalName: z.string().trim().max(200).nullable().default(null),
  taxId: z.string().trim().max(32).nullable().default(null),
  email: email.nullable().default(null),
  phone: z.string().trim().max(32).nullable().default(null),
  address: z.string().trim().max(300).nullable().default(null),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1).max(64),
  locale: z.string().min(2).max(16).default("es-MX"),
  pricesIncludeTax: z.boolean(),
  receiptFooter: z.string().trim().max(300).nullable().default(null),
  logoKey: z.string().max(300).nullable().default(null),
});
export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

export const taxRateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Basis points: 1600 = 16 %. */
  rateBps: z.number().int().min(0).max(10_000),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type TaxRateInput = z.infer<typeof taxRateSchema>;

export const LOCATION_TYPES = ["store", "warehouse"] as const;
export const locationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(LOCATION_TYPES),
  address: z.string().trim().max(300).nullable().default(null),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type LocationInput = z.infer<typeof locationSchema>;

export const createUserSchema = z.object({
  name,
  email,
  role: z.enum(["admin", "cashier"]),
  password,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "cashier"]).optional(),
  active: z.boolean().optional(),
});

export const roleSchema = z.enum(ROLES);
