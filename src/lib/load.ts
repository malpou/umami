import type { Website } from '@/generated/prisma/client';
import kv from '@/lib/kv';
import { getWebsite } from '@/queries/prisma';

export async function fetchWebsite(websiteId: string): Promise<Website> {
  const website = await kv.cache.fetch(`website:${websiteId}`, () => getWebsite(websiteId), 86400);

  if (!website || website.deletedAt) {
    return null;
  }

  return website;
}

export async function fetchAccount(userId: string) {
  const account = await kv.cache.get(`account:${userId}`);

  return account;
}

export async function fetchTeam(teamId: string) {
  const team = await kv.cache.get(`team:${teamId}`);

  return team;
}
