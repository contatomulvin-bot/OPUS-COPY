import {
  CreditTransactionKind,
  Prisma,
  ReservationStatus
} from "@prisma/client";
import { prisma } from "./db.js";

export class CreditError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (!retryable || attempt === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw new Error("Transaction retry limit reached");
}

async function activeUnlimited(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const now = new Date();
  const subscription = await tx.subscription.findFirst({
    where: {
      userId,
      unlimited: true,
      status: "ACTIVE",
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }]
    },
    select: { id: true }
  });
  return Boolean(subscription);
}

export async function quoteCredits(userId: string, actionCode: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new CreditError("INVALID_QUANTITY", "Quantidade inválida.");
  }
  const [action, wallet] = await Promise.all([
    prisma.creditAction.findUnique({ where: { code: actionCode } }),
    prisma.creditWallet.findUnique({ where: { userId } })
  ]);
  if (!action || !action.enabled) {
    throw new CreditError("ACTION_UNAVAILABLE", "Esta ação não está disponível.");
  }
  const unlimited = await prisma.subscription.findFirst({
    where: {
      userId,
      unlimited: true,
      status: "ACTIVE",
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }]
    },
    select: { id: true }
  });
  const totalCost = unlimited ? 0 : action.unitCost * quantity;
  return {
    actionCode,
    quantity,
    unitCost: unlimited ? 0 : action.unitCost,
    totalCost,
    unlimited: Boolean(unlimited),
    availableCredits: wallet?.balance || 0,
    reservedCredits: wallet?.reserved || 0
  };
}

export async function reserveCredits(input: {
  userId: string;
  deviceId?: string | null;
  actionCode: string;
  quantity: number;
  idempotencyKey: string;
  description?: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
    throw new CreditError("INVALID_QUANTITY", "Quantidade inválida.");
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new CreditError("INVALID_IDEMPOTENCY_KEY", "Chave de idempotência inválida.");
  }

  return serializable(async tx => {
    const existing = await tx.creditReservation.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: input.userId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
    if (existing) {
      const wallet = await tx.creditWallet.findUnique({ where: { userId: input.userId } });
      return { reservation: existing, wallet, created: false };
    }

    const action = await tx.creditAction.findUnique({ where: { code: input.actionCode } });
    if (!action || !action.enabled) {
      throw new CreditError("ACTION_UNAVAILABLE", "Esta ação não está disponível.");
    }

    const wallet = await tx.creditWallet.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId },
      update: {}
    });

    const unlimited = await activeUnlimited(tx, input.userId);
    const amount = unlimited ? 0 : action.unitCost * input.quantity;

    if (wallet.balance < amount) {
      throw new CreditError(
        "INSUFFICIENT_CREDITS",
        "Créditos insuficientes para iniciar este processamento."
      );
    }

    const nextWallet = amount > 0
      ? await tx.creditWallet.update({
          where: { userId: input.userId },
          data: {
            balance: { decrement: amount },
            reserved: { increment: amount }
          }
        })
      : wallet;

    const reservation = await tx.creditReservation.create({
      data: {
        userId: input.userId,
        deviceId: input.deviceId || null,
        actionCode: input.actionCode,
        quantity: input.quantity,
        amount,
        idempotencyKey: input.idempotencyKey,
        description: input.description
      }
    });

    if (amount > 0) {
      await tx.creditTransaction.create({
        data: {
          userId: input.userId,
          amount: -amount,
          balanceAfter: nextWallet.balance,
          kind: CreditTransactionKind.RESERVATION,
          reservationId: reservation.id,
          description: input.description || "Créditos reservados para processamento"
        }
      });
    }

    return { reservation, wallet: nextWallet, created: true };
  });
}

export async function commitReservation(
  userId: string,
  reservationId: string,
  actualQuantity?: number,
  resultJson?: string
) {
  return serializable(async tx => {
    const reservation = await tx.creditReservation.findFirst({
      where: { id: reservationId, userId }
    });
    if (!reservation) {
      throw new CreditError("RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    }
    if (reservation.status === ReservationStatus.COMMITTED) {
      const wallet = await tx.creditWallet.findUnique({ where: { userId } });
      return { reservation, wallet };
    }
    if (reservation.status === ReservationStatus.REFUNDED) {
      throw new CreditError("RESERVATION_ALREADY_REFUNDED", "Esta reserva já foi reembolsada.");
    }

    const settledQuantity =
      actualQuantity === undefined ? reservation.quantity : actualQuantity;

    if (
      !Number.isInteger(settledQuantity) ||
      settledQuantity < 0 ||
      settledQuantity > reservation.quantity
    ) {
      throw new CreditError(
        "INVALID_SETTLED_QUANTITY",
        "Quantidade concluída inválida para esta reserva."
      );
    }

    const unitCost =
      reservation.quantity > 0 ? Math.floor(reservation.amount / reservation.quantity) : 0;
    const settledAmount = unitCost * settledQuantity;
    const refundAmount = Math.max(0, reservation.amount - settledAmount);

    const wallet = reservation.amount > 0
      ? await tx.creditWallet.update({
          where: { userId },
          data: {
            reserved: { decrement: reservation.amount },
            balance: refundAmount > 0 ? { increment: refundAmount } : undefined
          }
        })
      : await tx.creditWallet.findUnique({ where: { userId } });

    if (refundAmount > 0 && wallet) {
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: refundAmount,
          balanceAfter: wallet.balance,
          kind: CreditTransactionKind.REFUND,
          reservationId: reservation.id,
          description: "Ajuste automático: menos clips concluídos que o reservado"
        }
      });
    }

    const updated = await tx.creditReservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.COMMITTED,
        committedAt: new Date(),
        settledQuantity,
        settledAmount,
        resultJson: resultJson ?? reservation.resultJson
      }
    });

    return { reservation: updated, wallet };
  });
}

export async function refundReservation(userId: string, reservationId: string, description?: string) {
  return serializable(async tx => {
    const reservation = await tx.creditReservation.findFirst({
      where: { id: reservationId, userId }
    });
    if (!reservation) {
      throw new CreditError("RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    }
    if (reservation.status === ReservationStatus.REFUNDED) {
      const wallet = await tx.creditWallet.findUnique({ where: { userId } });
      return { reservation, wallet };
    }
    if (reservation.status === ReservationStatus.COMMITTED) {
      throw new CreditError("RESERVATION_ALREADY_COMMITTED", "Esta reserva já foi confirmada.");
    }

    const wallet = reservation.amount > 0
      ? await tx.creditWallet.update({
          where: { userId },
          data: {
            balance: { increment: reservation.amount },
            reserved: { decrement: reservation.amount }
          }
        })
      : await tx.creditWallet.findUnique({ where: { userId } });

    const updated = await tx.creditReservation.update({
      where: { id: reservation.id },
      data: { status: ReservationStatus.REFUNDED, refundedAt: new Date() }
    });

    if (reservation.amount > 0 && wallet) {
      await tx.creditTransaction.create({
        data: {
          userId,
          amount: reservation.amount,
          balanceAfter: wallet.balance,
          kind: CreditTransactionKind.REFUND,
          reservationId: reservation.id,
          description: description || "Reembolso por processamento não concluído"
        }
      });
    }

    return { reservation: updated, wallet };
  });
}

export async function grantCredits(input: {
  userId: string;
  amount: number;
  kind: CreditTransactionKind;
  description: string;
  stripeEventId?: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new CreditError("INVALID_GRANT", "Valor de crédito inválido.");
  }

  return serializable(async tx => {
    if (input.stripeEventId) {
      const existing = await tx.creditTransaction.findUnique({
        where: { stripeEventId: input.stripeEventId }
      });
      if (existing) {
        const wallet = await tx.creditWallet.findUnique({ where: { userId: input.userId } });
        return { transaction: existing, wallet };
      }
    }

    const wallet = await tx.creditWallet.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, balance: input.amount },
      update: { balance: { increment: input.amount } }
    });

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        balanceAfter: wallet.balance,
        kind: input.kind,
        stripeEventId: input.stripeEventId,
        description: input.description
      }
    });

    return { transaction, wallet };
  });
}

export async function adminAdjustCredits(input: {
  adminId: string;
  userId: string;
  amount: number;
  reason: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw new CreditError("INVALID_ADJUSTMENT", "Ajuste inválido.");
  }

  return serializable(async tx => {
    const wallet = await tx.creditWallet.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        balance: 0
      },
      update: {}
    });

    if (wallet.balance + input.amount < 0) {
      throw new CreditError("NEGATIVE_BALANCE", "O ajuste deixaria o saldo negativo.");
    }

    const nextWallet = await tx.creditWallet.update({
      where: { userId: input.userId },
      data: { balance: { increment: input.amount } }
    });

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        balanceAfter: nextWallet.balance,
        kind: CreditTransactionKind.ADMIN_ADJUSTMENT,
        adminId: input.adminId,
        description: input.reason
      }
    });

    await tx.adminAuditLog.create({
      data: {
        adminId: input.adminId,
        action: "CREDIT_ADJUSTMENT",
        targetType: "USER",
        targetId: input.userId,
        oldValue: JSON.stringify({ balance: wallet.balance }),
        newValue: JSON.stringify({ balance: nextWallet.balance, delta: input.amount }),
        ip: input.ip || null,
        userAgent: input.userAgent || null
      }
    });

    return { transaction, wallet: nextWallet };
  });
}
