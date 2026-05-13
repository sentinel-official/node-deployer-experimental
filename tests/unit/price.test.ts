import { describe, expect, it } from 'vitest';
import { formatBase, formatPrices, formatQuote } from '../../src/main/services/price';

describe('formatBase', () => {
  it('emits 0 for zero', () => {
    expect(formatBase(0)).toBe('0');
    expect(formatBase('0')).toBe('0');
    expect(formatBase('0.0')).toBe('0.0');
  });
  it('trims trailing zeros for non-zero numbers', () => {
    expect(formatBase(0.05)).toBe('0.05');
    expect(formatBase(0.0025)).toBe('0.0025');
  });
  it('passes decimal strings through verbatim', () => {
    expect(formatBase('0.05')).toBe('0.05');
    expect(formatBase('1.23456789012345')).toBe('1.23456789012345');
  });
  it('rejects negatives, NaN, Infinity, and garbage strings', () => {
    expect(() => formatBase(-1)).toThrow();
    expect(() => formatBase(Number.NaN)).toThrow();
    expect(() => formatBase(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatBase('abc')).toThrow();
    expect(() => formatBase('1.2.3')).toThrow();
  });
});

describe('formatQuote', () => {
  it('emits integers as decimal strings', () => {
    expect(formatQuote(50000)).toBe('50000');
    expect(formatQuote(0)).toBe('0');
  });
  it('accepts bigints and integer strings (underscores stripped)', () => {
    expect(formatQuote(12_500_000n)).toBe('12500000');
    expect(formatQuote('12_500_000')).toBe('12500000');
  });
  it('rejects fractional numbers and garbage', () => {
    expect(() => formatQuote(1.5)).toThrow();
    expect(() => formatQuote(-1)).toThrow();
    expect(() => formatQuote('1.5')).toThrow();
    expect(() => formatQuote('abc')).toThrow();
  });
});

describe('formatPrices', () => {
  it('emits a single entry with comma between BASE and QUOTE', () => {
    expect(formatPrices([{ denom: 'udvpn', base: '0', quote: '50000' }])).toBe(
      'udvpn:0,50000',
    );
  });
  it('joins multiple entries with semicolons', () => {
    const out = formatPrices([
      { denom: 'udvpn', base: '0.05', quote: '2500000' },
      {
        denom: 'ibc/A8C2D23A1E6F95DA4E48BA349667E322BD7A6C996D8A4AAE8BA72E190F3D1477',
        base: '0.05',
        quote: '10000',
      },
    ]);
    expect(out).toBe(
      'ibc/A8C2D23A1E6F95DA4E48BA349667E322BD7A6C996D8A4AAE8BA72E190F3D1477:0.05,10000;udvpn:0.05,2500000',
    );
  });
  it('sorts denoms alphabetically (Prices.Validate requires it)', () => {
    const out = formatPrices([
      { denom: 'udvpn', base: '0', quote: '50000' },
      { denom: 'ibc/zzz', base: '0', quote: '1000' },
      { denom: 'ibc/aaa', base: '0', quote: '500' },
    ]);
    expect(out).toBe('ibc/aaa:0,500;ibc/zzz:0,1000;udvpn:0,50000');
  });
  it('rejects duplicate denoms', () => {
    expect(() =>
      formatPrices([
        { denom: 'udvpn', base: '0', quote: '50000' },
        { denom: 'udvpn', base: '0', quote: '50001' },
      ]),
    ).toThrow(/duplicate/);
  });
  it('rejects empty input', () => {
    expect(() => formatPrices([])).toThrow();
  });
});
