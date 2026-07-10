import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Timeout generoso para $transaction: la latencia de red hacia la DB (Neon
// serverless, cold-start del compute) puede superar los 5s default de Prisma
// en transacciones con varios round-trips secuenciales (loops de insumos/líneas).
export const OPCIONES_TX = { maxWait: 15000, timeout: 30000 };

// Tipo del cliente transaccional que reciben los servicios dentro de $transaction
export type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
