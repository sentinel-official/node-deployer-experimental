/**
 * Price-string serialization for sentinel-dvpnx config.
 *
 * The dvpnx binary parses `gigabyte_prices` / `hourly_prices` via
 * `sentinelhub/v12/types/v1/price.NewPricesFromString`:
 *
 *   - Multiple denoms are SEMICOLON-separated (NOT comma).
 *   - Each entry is `denom:BASE,QUOTE`.
 *     * BASE = sdkmath.LegacyDec USD price target. `0` disables the oracle
 *       path; the node then quotes the literal QUOTE forever.
 *     * QUOTE = sdkmath.Int smallest-unit fallback in the price denom
 *       (e.g. udvpn integer).
 *   - Entries must be alphabetically sorted by denom — Validate() calls
 *     Sort() before checking duplicates.
 *
 * Getting the separator wrong panics the binary at startup. Getting the
 * sort wrong fails Validate() with "duplicate denom". Hence this module.
 */

export interface PriceEntry {
  denom: string;
  /** USD target. `'0'` (or `0`) disables the oracle path. */
  base: number | string;
  /** Smallest-unit fallback in the price denom. */
  quote: number | bigint | string;
}

/**
 * Format BASE for the LegacyDec parser. Accepts JS numbers, bigints, or
 * strings. `0` and `0.0` are both valid; the parser short-circuits on
 * `BaseValue.IsZero()`.
 */
export function formatBase(value: number | string): string {
  if (typeof value === 'string') {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) {
      throw new Error(`formatBase: not a decimal: ${value}`);
    }
    return value.trim();
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`formatBase: must be a non-negative finite number: ${value}`);
  }
  if (value === 0) return '0';
  // LegacyDec has 18-decimal precision but JS Number gives us 15-17 sig
  // figs of binary-float garbage past that. Round-trip through a 15-sig-fig
  // string (the IEEE-754 double "shortest unique" boundary) to drop the
  // trailing 0.0500000…03 noise, then trim trailing zeros for readability.
  const s = value.toPrecision(15);
  // toPrecision can give scientific notation for tiny/huge values. Reject;
  // callers should pass a decimal string directly in that case.
  if (s.includes('e') || s.includes('E')) {
    throw new Error(`formatBase: value out of safe decimal range: ${value}`);
  }
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Format QUOTE as a plain integer string. The parser uses
 * `sdkmath.NewIntFromString` which accepts underscores; we omit them to
 * keep diff noise low.
 */
export function formatQuote(value: number | bigint | string): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    const cleaned = value.replace(/_/g, '').trim();
    if (!/^-?\d+$/.test(cleaned)) {
      throw new Error(`formatQuote: not an integer: ${value}`);
    }
    return cleaned;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`formatQuote: must be a non-negative integer: ${value}`);
  }
  return String(value);
}

/**
 * Serialize a list of price entries into the dvpnx-compatible string.
 * Sorts by denom and joins with `;`.
 */
export function formatPrices(entries: PriceEntry[]): string {
  if (entries.length === 0) {
    throw new Error('formatPrices: at least one entry required');
  }
  const seen = new Set<string>();
  const parts = [...entries]
    .sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0))
    .map((e) => {
      if (seen.has(e.denom)) {
        throw new Error(`formatPrices: duplicate denom ${e.denom}`);
      }
      seen.add(e.denom);
      return `${e.denom}:${formatBase(e.base)},${formatQuote(e.quote)}`;
    });
  return parts.join(';');
}
