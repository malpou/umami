import { saveAuth } from '@/lib/auth';
import { hash } from '@/lib/crypto';
import { parseRequest } from '@/lib/request';
import { json } from '@/lib/response';
import { getUser } from '@/queries/prisma';

export async function POST(request: Request) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const user = await getUser(auth.user.id, { includePassword: true });
  const token = await saveAuth({ userId: auth.user.id, pwd: hash(user.password) }, 86400);

  return json({ user: auth.user, token });
}
