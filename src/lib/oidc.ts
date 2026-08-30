import crypto from 'node:crypto';
import debug from 'debug';
import * as client from 'openid-client';
import { ROLES } from '@/lib/constants';
import { decrypt, encrypt, secret, uuid } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import type { Role } from '@/lib/types';
import {
  createUser,
  getUserByOidcIdentity,
  getUserForOidcLink,
  updateUser,
} from '@/queries/prisma/user';

const log = debug('umami:oidc');

export const OIDC_STATE_COOKIE = 'umami.oidc';

const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;

export const DEFAULT_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles';
export const DEFAULT_SCOPES = 'openid profile email urn:zitadel:iam:org:projects:roles';

export interface OidcRoleMap {
  admin: string[];
  user: string[];
  viewOnly: string[];
}

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  rolesClaim: string;
  roleMap: OidcRoleMap;
  allowLocalLogin: boolean;
  providerName: string;
  rpLogout: boolean;
  autoLinkUsername: boolean;
  sessionDurationSeconds: number;
  appUrl: string;
  basePath: string;
  redirectUri: string;
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function parseDuration(value: string | undefined, defaultSeconds: number): number {
  if (!value) {
    return defaultSeconds;
  }

  const match = /^(\d+)([smhd]?)$/.exec(value.trim());

  if (!match) {
    return defaultSeconds;
  }

  const num = Number(match[1]);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] || 's'];

  return num * unit;
}

export function getOidcConfig(): OidcConfig {
  const issuer = process.env.OIDC_ISSUER;
  const clientId = process.env.OIDC_CLIENT_ID;
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const basePath = process.env.BASE_PATH || '';

  return {
    enabled: !!(issuer && clientId),
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET || undefined,
    scopes: process.env.OIDC_SCOPES || DEFAULT_SCOPES,
    rolesClaim: process.env.OIDC_ROLES_CLAIM || DEFAULT_ROLES_CLAIM,
    roleMap: {
      admin: parseList(process.env.OIDC_ROLE_ADMIN),
      user: parseList(process.env.OIDC_ROLE_USER),
      viewOnly: parseList(process.env.OIDC_ROLE_VIEW_ONLY),
    },
    allowLocalLogin: !!process.env.OIDC_ALLOW_LOCAL_LOGIN,
    providerName: process.env.OIDC_PROVIDER_NAME || 'SSO',
    rpLogout: !!process.env.OIDC_RP_LOGOUT,
    autoLinkUsername: !!process.env.OIDC_AUTO_LINK_USERNAME,
    sessionDurationSeconds: parseDuration(process.env.OIDC_SESSION_DURATION, 86400),
    appUrl,
    basePath,
    redirectUri: `${appUrl}${basePath}/api/auth/oidc/callback`,
  };
}

let discoveryCache: { configuration: client.Configuration; expiresAt: number } | null = null;

export async function getOidcClient(): Promise<client.Configuration> {
  const config = getOidcConfig();

  if (!config.enabled) {
    throw new Error('OIDC is not configured');
  }

  if (discoveryCache && discoveryCache.expiresAt > Date.now()) {
    return discoveryCache.configuration;
  }

  const issuerUrl = new URL(config.issuer);

  try {
    const configuration = await client.discovery(
      issuerUrl,
      config.clientId,
      undefined,
      config.clientSecret ? client.ClientSecretBasic(config.clientSecret) : client.None(),
      // Allow plain http for local development IdPs only.
      issuerUrl.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined,
    );

    discoveryCache = { configuration, expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS };

    return configuration;
  } catch (e) {
    discoveryCache = null;
    log('OIDC discovery failed', e);
    throw e;
  }
}

export function clearOidcClientCache() {
  discoveryCache = null;
}

export function sealLoginState(data: {
  state: string;
  codeVerifier: string;
  nonce: string;
}): string {
  return encrypt(JSON.stringify({ ...data, iat: Date.now() }), secret());
}

export function openLoginState(
  value: string,
): { state: string; codeVerifier: string; nonce: string } | null {
  try {
    const { state, codeVerifier, nonce, iat } = JSON.parse(decrypt(value, secret()));

    if (!state || !codeVerifier || !nonce || !iat || Date.now() - iat > STATE_MAX_AGE_MS) {
      return null;
    }

    return { state, codeVerifier, nonce };
  } catch {
    return null;
  }
}

export function loginStateCookie(value: string | null): string {
  const config = getOidcConfig();
  const path = `${config.basePath}/api/auth/oidc`;
  const secure = config.appUrl.startsWith('https://') ? '; Secure' : '';

  if (value === null) {
    return `${OIDC_STATE_COOKIE}=; HttpOnly; Path=${path}; SameSite=Lax; Max-Age=0${secure}`;
  }

  return `${OIDC_STATE_COOKIE}=${encodeURIComponent(
    value,
  )}; HttpOnly; Path=${path}; SameSite=Lax; Max-Age=600${secure}`;
}

export function getCookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');

  if (!header) {
    return null;
  }

  for (const part of header.split(';')) {
    const index = part.indexOf('=');

    if (index === -1) {
      continue;
    }

    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
}

export function normalizeRoleKeys(raw: unknown): string[] {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    return raw.filter(value => typeof value === 'string');
  }

  if (typeof raw === 'object') {
    return Object.keys(raw);
  }

  if (typeof raw === 'string') {
    return raw.split(/[\s,]+/).filter(Boolean);
  }

  return [];
}

export function resolveRole(claims: Record<string, unknown>, config: OidcConfig): Role | null {
  const keys = normalizeRoleKeys(claims?.[config.rolesClaim]);

  if (keys.some(key => config.roleMap.admin.includes(key))) {
    return ROLES.admin;
  }

  if (keys.some(key => config.roleMap.user.includes(key))) {
    return ROLES.user;
  }

  if (keys.some(key => config.roleMap.viewOnly.includes(key))) {
    return ROLES.viewOnly;
  }

  return null;
}

export function pickUsername(claims: Record<string, unknown>): string {
  const value = claims?.preferred_username || claims?.email || claims?.sub;

  return String(value || '')
    .toLowerCase()
    .slice(0, 255);
}

function suffixUsername(username: string, subject: string): string {
  const suffix = `-${subject.slice(0, 8).toLowerCase()}`;

  return `${username.slice(0, 255 - suffix.length)}${suffix}`;
}

function pickDisplayName(claims: Record<string, unknown>): string | undefined {
  return typeof claims?.name === 'string' ? claims.name.slice(0, 255) : undefined;
}

function isUniqueConstraintError(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

export async function findOrCreateOidcUser(
  issuer: string,
  subject: string,
  claims: Record<string, unknown>,
  role: Role,
) {
  const config = getOidcConfig();
  const displayName = pickDisplayName(claims);
  const existing = await getUserByOidcIdentity(issuer, subject);

  // Existing OIDC user: the IdP is the source of truth, so re-sync on every login.
  if (existing) {
    const data: Record<string, string> = {};

    if (existing.role !== role) {
      data.role = role;
    }

    if (displayName !== undefined && displayName !== existing.displayName) {
      data.displayName = displayName;
    }

    const username = pickUsername(claims);

    if (username && username !== existing.username) {
      const taken = await getUserForOidcLink(username);

      if (!taken) {
        data.username = username;
      } else {
        log(`Username ${username} is taken; keeping ${existing.username}`);
      }
    }

    if (Object.keys(data).length > 0) {
      await updateUser(existing.id, data);
    }

    return { ...existing, ...data };
  }

  let username = pickUsername(claims);

  if (!username) {
    return null;
  }

  const taken = await getUserForOidcLink(username);

  if (taken) {
    if (config.autoLinkUsername && !taken.oidcIssuer) {
      await updateUser(taken.id, {
        oidcIssuer: issuer,
        oidcSubject: subject,
        role,
        ...(displayName !== undefined && { displayName }),
      });

      return getUserByOidcIdentity(issuer, subject);
    }

    username = suffixUsername(username, subject);
  }

  const data = {
    username,
    // Unusable random password: keeps the NOT NULL column and the
    // password-fingerprint token invalidation in checkAuth working.
    password: hashPassword(crypto.randomBytes(32).toString('hex')),
    role,
    displayName,
    oidcIssuer: issuer,
    oidcSubject: subject,
  };

  try {
    await createUser({ id: uuid(), ...data });
  } catch (e) {
    if (!isUniqueConstraintError(e)) {
      throw e;
    }

    // Concurrent first login for the same identity.
    const byIdentity = await getUserByOidcIdentity(issuer, subject);

    if (byIdentity) {
      return byIdentity;
    }

    // Username race: retry once with a suffixed name.
    await createUser({ id: uuid(), ...data, username: suffixUsername(username, subject) });
  }

  return getUserByOidcIdentity(issuer, subject);
}
