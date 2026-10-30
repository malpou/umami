import crypto from 'node:crypto';
import { createVerifier, EdgeAuthInvalid, type Identity, type Verifier } from '@metsaapp/edgeauth';
import debug from 'debug';
import { ROLES } from '@/lib/constants';
import { uuid } from '@/lib/crypto';
import { hashPassword } from '@/lib/password';
import type { Role } from '@/lib/types';
import {
  createUser,
  getUserByOidcIdentity,
  getUserForOidcLink,
  updateUser,
} from '@/queries/prisma/user';

// Sign-in through guard: guard is the OIDC relying party and owns the
// sessions; every request it lets through carries a short-lived identity JWT
// (x-bastion-identity), verified here with @metsaapp/edgeauth. Umami keeps no
// OIDC client and no login sessions of its own in this mode.

const log = debug('umami:guard');

export const GUARD_LOGIN_PATH = '/.well-known/bastion/login';

export interface GuardRoleMap {
  admin: string[];
  user: string[];
  viewOnly: string[];
}

export interface GuardConfig {
  enabled: boolean;
  // The issuer users are keyed by (user.oidc_issuer): the Zitadel issuer, so
  // accounts created by the earlier OIDC login keep their data.
  issuer: string;
  roleMap: GuardRoleMap;
  autoLinkUsername: boolean;
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function getGuardConfig(): GuardConfig {
  return {
    enabled: !!process.env.GUARD_IDENTITY,
    issuer: process.env.GUARD_USER_ISSUER || '',
    roleMap: {
      admin: parseList(process.env.GUARD_ROLE_ADMIN),
      user: parseList(process.env.GUARD_ROLE_USER),
      viewOnly: parseList(process.env.GUARD_ROLE_VIEW_ONLY),
    },
    autoLinkUsername: !!process.env.GUARD_AUTO_LINK_USERNAME,
  };
}

// What is missing for GUARD_IDENTITY to sign anyone in; null when complete.
// Missing, every request would be refused, so the server refuses to start.
export function guardConfigError(): string | null {
  if (!isGuardIdentityEnabled()) {
    return null;
  }

  const config = getGuardConfig();

  if (parseList(process.env.PLATFORM_KIT_EDGEAUTH_AUDIENCES).length === 0) {
    return 'PLATFORM_KIT_EDGEAUTH_AUDIENCES is not set.';
  }

  if (!config.issuer) {
    return 'GUARD_USER_ISSUER is not set.';
  }

  const { admin, user, viewOnly } = config.roleMap;

  if (admin.length + user.length + viewOnly.length === 0) {
    return 'Set at least one of GUARD_ROLE_ADMIN, GUARD_ROLE_USER or GUARD_ROLE_VIEW_ONLY.';
  }

  return null;
}

export function isGuardIdentityEnabled(): boolean {
  return !!process.env.GUARD_IDENTITY;
}

export function guardLoginUrl(returnTo = '/'): string {
  return `${GUARD_LOGIN_PATH}?return_to=${encodeURIComponent(returnTo)}`;
}

let verifier: Verifier | null = null;

export function getVerifier(): Verifier {
  if (!verifier) {
    verifier = createVerifier({
      audiences: parseList(process.env.PLATFORM_KIT_EDGEAUTH_AUDIENCES),
    });
  }

  return verifier;
}

// For tests: drop the cached verifier so a changed environment takes effect.
export function resetVerifier() {
  verifier = null;
}

// The verified identity on the request; null when it carries none (or an
// invalid one, which is logged). Rejects with EdgeAuthUnavailable when guard's
// keys cannot be fetched, so the caller can answer 503.
export async function getRequestIdentity(request: Request): Promise<Identity | null> {
  try {
    return await getVerifier().fromHeaders(request.headers);
  } catch (e) {
    if (e instanceof EdgeAuthInvalid) {
      // Always logged: only an attack or a key mistake produces one.
      console.warn(`Invalid guard identity token: ${e.message}`);
      return null;
    }

    throw e;
  }
}

export function resolveRole(roles: string[], roleMap: GuardRoleMap): Role | null {
  if (roles.some(key => roleMap.admin.includes(key))) {
    return ROLES.admin;
  }

  if (roles.some(key => roleMap.user.includes(key))) {
    return ROLES.user;
  }

  if (roles.some(key => roleMap.viewOnly.includes(key))) {
    return ROLES.viewOnly;
  }

  return null;
}

export function pickUsername(identity: Identity): string {
  return String(identity.email || identity.subject || '')
    .toLowerCase()
    .slice(0, 255);
}

function suffixUsername(username: string, subject: string): string {
  const suffix = `-${subject.slice(0, 8).toLowerCase()}`;

  return `${username.slice(0, 255 - suffix.length)}${suffix}`;
}

function pickDisplayName(identity: Identity): string | undefined {
  return identity.name ? identity.name.slice(0, 255) : undefined;
}

function isUniqueConstraintError(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

// Maps guard's identity to the Umami user linked to (issuer, subject), as the
// earlier OIDC login did, creating it on first sight. Guard's role keys are the
// source of truth for the Umami role. An existing user's username is never
// changed: the identity carries no preferred_username, the claim it came from.
export async function findOrCreateGuardUser(issuer: string, identity: Identity, role: Role) {
  const config = getGuardConfig();
  const subject = identity.subject;
  const displayName = pickDisplayName(identity);
  const existing = await getUserByOidcIdentity(issuer, subject);

  if (existing) {
    const data: Record<string, string> = {};

    if (existing.role !== role) {
      data.role = role;
    }

    if (displayName !== undefined && displayName !== existing.displayName) {
      data.displayName = displayName;
    }

    if (Object.keys(data).length > 0) {
      await updateUser(existing.id, data);
    }

    return { ...existing, ...data };
  }

  let username = pickUsername(identity);

  if (!username) {
    return null;
  }

  const taken = await getUserForOidcLink(username);

  if (taken) {
    // Auto-link only on an email guard reports as verified, never on the bare
    // subject id.
    const linkSafe = !!identity.email && identity.emailVerified;

    if (config.autoLinkUsername && linkSafe && !taken.oidcIssuer) {
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
    // Unusable random password: keeps the NOT NULL column.
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

    // Concurrent first request for the same identity.
    const byIdentity = await getUserByOidcIdentity(issuer, subject);

    if (byIdentity) {
      return byIdentity;
    }

    // Username race: retry once with a suffixed name.
    await createUser({ id: uuid(), ...data, username: suffixUsername(username, subject) });
  }

  return getUserByOidcIdentity(issuer, subject);
}

// The Umami user id for the request's identity, or null when it has none or
// its roles map to no Umami role (fail closed).
export async function getGuardUserId(request: Request): Promise<string | null> {
  const identity = await getRequestIdentity(request);

  if (!identity) {
    return null;
  }

  const config = getGuardConfig();

  if (!config.issuer) {
    log('GUARD_USER_ISSUER is not set');
    return null;
  }

  const role = resolveRole(identity.roles, config.roleMap);

  if (!role) {
    log('Identity has no mapped role', identity.subject);
    return null;
  }

  const user = await findOrCreateGuardUser(config.issuer, identity, role);

  return user?.id ?? null;
}
