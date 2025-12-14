export function getTRPCErrorClass(): any | null {
  try {
    // Try named import via require
    const mod = require("@trpc/server");
    if (mod && mod.TRPCError) return mod.TRPCError;
  } catch (e) {
    // ignore
  }

  try {
    // Try deep import (not recommended but may work across versions)
    const mod = require("@trpc/server/dist/declarations/src/errors");
    if (mod && mod.TRPCError) return mod.TRPCError;
  } catch (e) {
    // ignore
  }

  return null;
}

export function normalizeTrpcError(err: unknown) {
  const e: any = err as any;
  return {
    code: typeof e?.code === "string" ? e.code : undefined,
    message: typeof e?.message === "string" ? e.message : undefined,
  };
}
