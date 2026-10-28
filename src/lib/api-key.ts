import { hash } from '@/lib/crypto';
import { getRandomChars } from '@/lib/generate';

export const API_KEY_PREFIX = 'umami_';
export const API_KEY_LENGTH = 32;
export const API_KEY_DISPLAY_LENGTH = API_KEY_PREFIX.length + 8;
export const API_KEY_LAST_USED_INTERVAL = 5 * 60 * 1000;

// Routes that manage account credentials or admin state must not be
// reachable with an API key. Matched as path prefixes.
export const API_KEY_BLOCKED_PATHS = [
  '/api/me/password',
  '/api/me/api-keys',
  '/api/2fa',
  '/api/auth',
  '/api/users',
  '/api/admin',
];

export function generateApiKey() {
  return `${API_KEY_PREFIX}${getRandomChars(API_KEY_LENGTH)}`;
}

export function hashApiKey(key: string) {
  return hash(key);
}

export function getApiKeyPrefix(key: string) {
  return key.slice(0, API_KEY_DISPLAY_LENGTH);
}

export function isApiKey(token?: string | null): token is string {
  return typeof token === 'string' && token.startsWith(API_KEY_PREFIX);
}

export function isApiKeyBlockedPath(pathname: string) {
  return API_KEY_BLOCKED_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`));
}

// Disabled in this fork: a key never expires and survives removal of the user's
// role at the identity provider, so revoking the grant would no longer cut access.
// Upstream enables keys whenever CLOUD_MODE is unset; revert this to restore that.
export function isApiKeyEnabled() {
  return false;
}
