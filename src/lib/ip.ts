import ipaddr from 'ipaddr.js';

export const IP_ADDRESS_HEADERS = [
  ...(process.env.CLOUD_MODE ? ['x-umami-client-ip'] : []), // Umami custom header (cloud mode only)
  'true-client-ip', // CDN
  'cf-connecting-ip', // Cloudflare
  'fastly-client-ip', // Fastly
  'x-nf-client-connection-ip', // Netlify
  'do-connecting-ip', // Digital Ocean
  'x-real-ip', // Reverse proxy
  'x-appengine-user-ip', // Google App Engine
  'x-forwarded-for',
  'forwarded',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-forwarded',
];

function normalizeIp(ip?: string | null) {
  if (!ip) return ip;

  try {
    const parsed = ipaddr.parse(ip);

    if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (parsed as ipaddr.IPv6).toIPv4Address().toString();
    }

    return parsed.toString();
  } catch {
    // Fallback: return original if parsing fails
    return ip;
  }
}

function resolveIp(ip?: string | null) {
  if (!ip) return ip;

  // First, try as-is
  const normalized = normalizeIp(ip);
  try {
    ipaddr.parse(normalized);
    return normalized;
  } catch {
    // try stripping port (handles IPv4:port; leaves IPv6 intact)
    const stripped = stripPort(ip);
    if (stripped !== ip) {
      const normalizedStripped = normalizeIp(stripped);
      try {
        ipaddr.parse(normalizedStripped);
        return normalizedStripped;
      } catch {
        return normalizedStripped;
      }
    }

    return normalized;
  }
}

// metsa: the client address is the rightmost X-Forwarded-For entry outside
// the cluster's own ranges, never a header the client can set. Umami runs
// DNS-only behind Envoy Gateway, which appends the address it accepted the
// connection from (the Hetzner load balancer's PROXY protocol peer) as the
// last entry; everything before it is the client's to write. The pod network
// (100.64.0.0/10, "carrierGradeNat" to ipaddr.js), private and loopback
// entries are skipped, in case anything inside the cluster appends its own.
// CLIENT_IP_HEADER and the CDN headers in IP_ADDRESS_HEADERS are ignored:
// nothing in front of Umami sets them, so any client could.
const INTERNAL_RANGES = new Set([
  'private',
  'loopback',
  'carrierGradeNat',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
]);

function isInternal(ip: string) {
  const addr = ipaddr.process(ip);

  return INTERNAL_RANGES.has(addr.range());
}

export function getIpAddress(headers: Headers) {
  const value = headers.get('x-forwarded-for');

  if (!value) {
    return undefined;
  }

  const entries = value.split(',').map(entry => resolveIp(entry.trim()));

  for (let i = entries.length - 1; i >= 0; i--) {
    const ip = entries[i];

    // An entry that is no address was not written by the gateway: trust
    // nothing before it.
    if (!ip || !ipaddr.isValid(ip)) {
      return undefined;
    }

    if (!isInternal(ip)) {
      return ip;
    }
  }

  // Every entry is internal: a request from inside the cluster.
  return entries[0];
}

// metsa: the client address for a collect request. Through the gateway
// (Envoy always appends X-Forwarded-For, and a client cannot stop it) only the
// gateway's entry counts, and payload.ip is ignored. A request with no
// X-Forwarded-For never passed the gateway: it came from inside the cluster,
// such as the api's widget funnel forwarder, which names the visitor in
// payload.ip. That is believed when it is a valid address.
export function getClientIp(headers: Headers, payloadIp?: string | null) {
  if (headers.has('x-forwarded-for')) {
    return getIpAddress(headers);
  }

  const ip = resolveIp(payloadIp?.trim());

  return ip && ipaddr.isValid(ip) ? ip : undefined;
}

export function stripPort(ip?: string | null) {
  if (!ip) {
    return ip;
  }

  if (ip.startsWith('[')) {
    const endBracket = ip.indexOf(']');
    if (endBracket !== -1) {
      return ip.slice(0, endBracket + 1);
    }
  }

  const idx = ip.lastIndexOf(':');
  if (idx !== -1) {
    if (ip.includes('.') || /^[a-zA-Z0-9.-]+$/.test(ip.slice(0, idx))) {
      return ip.slice(0, idx);
    }
  }

  return ip;
}
