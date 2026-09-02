/**
 * Utilities for serializing Prisma database objects safely to JSON.
 * Converts BigInt fields (such as Video.fileSize) to Number (when within Number.MAX_SAFE_INTEGER)
 * or string (if exceeding safe integer limits) so JSON.stringify never throws "Do not know how to serialize a BigInt".
 */

export function serializeBigInt<T = any>(value: any): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(value) as any;
    }
    return value.toString() as any;
  }

  if (value instanceof Date) {
    return value.toISOString() as any;
  }

  if (Array.isArray(value)) {
    return value.map(item => serializeBigInt(item)) as any;
  }

  if (typeof value === 'object') {
    // If it's a plain object or class instance with properties
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = serializeBigInt(val);
    }
    return result as any;
  }

  return value;
}

/**
 * High-level alias for serializing any Prisma model or query result before returning via API
 */
export function serializePrisma<T = any>(data: T): T {
  return serializeBigInt<T>(data);
}
