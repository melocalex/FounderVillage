// Finds the program error inside a failed send, whatever layer wrapped it, so tests can assert
// the exact code and the harness can print its name.
import { getCachainErrorMessage, type CachainError } from './generated/cachain';

export type ProgramFailure = { instructionIndex: number; code: number };

/** Walks `cause` chains and error contexts for an `InstructionError: [index, { Custom: code }]`. */
export function findCustomError(error: unknown): ProgramFailure | undefined {
  const seen = new Set<unknown>();
  const visit = (value: unknown): ProgramFailure | undefined => {
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    const v = value as Record<string, unknown>;
    const ie = v.InstructionError ?? v.instructionError;
    if (Array.isArray(ie) && ie.length === 2) {
      const [index, inner] = ie as [unknown, unknown];
      const custom = (inner as Record<string, unknown> | undefined)?.Custom;
      if (typeof custom === 'number' || typeof custom === 'bigint') {
        return { instructionIndex: Number(index), code: Number(custom) };
      }
    }
    // Kit's SolanaError for a failed instruction carries { index, code } in its context.
    const context = v.context as Record<string, unknown> | undefined;
    if (context && typeof context.code === 'number' && typeof context.index === 'number') {
      return { instructionIndex: context.index, code: context.code };
    }
    for (const child of [v.cause, v.context, v.err, v.error, ...Object.values(v)]) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return undefined;
  };
  return visit(error);
}

/** Program error name for Cachain codes (6000+), Anchor's own (<6000) are left as numbers. */
export function describeError(code: number): string {
  return code >= 6000 ? getCachainErrorMessage(code as CachainError) : `Anchor or runtime error ${code}`;
}
