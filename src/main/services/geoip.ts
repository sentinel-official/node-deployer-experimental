import { log } from './logger';

interface GeoipResult {
  country: string;
  countryName: string;
}

const cache = new Map<string, GeoipResult>();

/**
 * Resolve a host / IP to an ISO-3166-1 alpha-2 country code using the free
 * https://ipwho.is/ endpoint (no API key, no rate-limit headers in normal
 * use). Falls back to undefined on any failure — callers must handle that.
 * Results are cached per-process.
 */
export async function resolveCountry(host: string): Promise<GeoipResult | undefined> {
  const key = host.trim().toLowerCase();
  if (!key) return undefined;
  if (cache.has(key)) return cache.get(key);

  // Skip obviously private / loopback literals — they will just return a
  // private-network error and waste a request.
  if (
    key === 'localhost' ||
    key.startsWith('127.') ||
    key.startsWith('10.') ||
    key.startsWith('192.168.') ||
    key.startsWith('172.16.') ||
    key.startsWith('172.17.') ||
    key.startsWith('172.18.') ||
    key.startsWith('172.19.') ||
    key.startsWith('172.2') ||
    key.startsWith('172.30.') ||
    key.startsWith('172.31.')
  ) {
    return undefined;
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(key)}`, {
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      success?: boolean;
      country_code?: string;
      country?: string;
    };
    if (!body.success || !body.country_code) return undefined;
    const out: GeoipResult = {
      country: body.country_code.toUpperCase(),
      countryName: body.country ?? body.country_code.toUpperCase(),
    };
    cache.set(key, out);
    return out;
  } catch (err) {
    log.debug('geoip lookup failed', { host: key, err: (err as Error).message });
    return undefined;
  }
}
