// LUNA — Kernel SSRF guard
// FIX: K-SSRF1/K-SSRF2 — Validates URLs against private/internal IP ranges.
// Reuses the same blocklist as engine/attachments/url-extractor.ts.

const BLOCKED_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^f[cd]/i,      // fc00::/7 ULA
  /^fe80:/i,      // link-local IPv6
  /^169\.254\./,  // link-local IPv4
  /^metadata\./i, // cloud metadata endpoints
]

/** Check if a URL targets a private/internal address. Throws if blocked. */
export function assertNotPrivateUrl(urlStr: string): void {
  let hostname: string
  try {
    hostname = new URL(urlStr).hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  } catch {
    throw new Error(`SSRF blocked: invalid URL "${urlStr}"`)
  }
  if (BLOCKED_PATTERNS.some(re => re.test(hostname))) {
    throw new Error(`SSRF blocked: URL targets private/internal address "${hostname}"`)
  }
}
