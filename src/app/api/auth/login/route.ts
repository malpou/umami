import { saveAuth } from '@/lib/auth';
import { PARTIAL_AUTH_TOKEN_TYPE, ROLES } from '@/lib/constants';
import { hash, secret } from '@/lib/crypto';
import { isGuardIdentityEnabled } from '@/lib/guard-identity';
import { createSecureToken } from '@/lib/jwt';
import { checkPassword } from '@/lib/password';
import prisma from '@/lib/prisma';
import { parseRequest } from '@/lib/request';
import { forbidden, json, serviceUnavailable, unauthorized } from '@/lib/response';
import { getTwoFactorConfigurationError, isTwoFactorConfigured } from '@/lib/two-factor/crypto';
import { getAllUserTeams, getUserByUsername } from '@/queries/prisma';
import { loginRequestSchema } from './schema';

export async function POST(request: Request) {
  // Behind guard, signing in is guard's job and no Umami session is accepted.
  if (isGuardIdentityEnabled()) {
    return forbidden({ code: 'local-login-disabled' });
  }

  const { body, error } = await parseRequest(request, loginRequestSchema, { skipAuth: true });

  if (error) {
    return error();
  }

  const { username, password } = body;

  const user = await getUserByUsername(username, { includePassword: true });

  if (!user || !checkPassword(password, user.password)) {
    return unauthorized({ code: 'incorrect-username-password' });
  }

  const { id, role, createdAt } = user;
  const cloudMode = !!process.env.CLOUD_MODE;

  // Check if 2FA is enabled for this user
  const twoFactor = !cloudMode
    ? await prisma.client.twoFactorAuth.findUnique({ where: { userId: id } })
    : null;

  if (twoFactor?.isEnabled) {
    if (!isTwoFactorConfigured()) {
      return serviceUnavailable(getTwoFactorConfigurationError());
    }

    const partialToken = createSecureToken(
      { userId: id, type: PARTIAL_AUTH_TOKEN_TYPE },
      secret(),
      {
        expiresIn: '5m',
      },
    );
    return json({ requiresTwoFactor: true, partialToken });
  }
  // Bind token to password hash so a password change invalidates old tokens.
  const pwd = hash(user.password);

  const token = await saveAuth({ userId: id, role, pwd });

  const teams = await getAllUserTeams(id);

  return json({
    token,
    user: { id, username, role, createdAt, isAdmin: role === ROLES.admin, teams },
  });
}
