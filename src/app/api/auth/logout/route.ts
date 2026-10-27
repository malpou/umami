import kv from '@/lib/kv';
import { parseRequest } from '@/lib/request';
import { ok } from '@/lib/response';

export async function POST(request: Request) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  if (auth?.authKey) {
    await kv.auth.del(auth.authKey);
  }

  return ok();
}
