import { beforeEach, expect, test, vi } from 'vitest';
import { getClientInfo, getLocation, hasBlockedIp } from './detect';

const isLocalhost = vi.mocked(await import('is-localhost-ip'));

vi.mock('is-localhost-ip', () => ({
  default: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();

  delete process.env.CLIENT_IP_HEADER;
  delete process.env.IGNORE_IP;
  delete process.env.SKIP_LOCATION_HEADERS;
});

const CLIENT = '89.167.61.215';

test('getClientInfo: payload.ip and CDN location headers are ignored', async () => {
  isLocalhost.default.mockResolvedValue(false);
  (globalThis as Record<string, unknown>).maxmind = {
    get: (ip: string) => (ip === CLIENT ? { country: { iso_code: 'DE' } } : undefined),
  };

  const info = await getClientInfo(
    new Request('https://insights.metsa.app/api/send', {
      headers: {
        'x-forwarded-for': `198.51.100.250, ${CLIENT}`,
        'cf-ipcountry': 'KP',
        'x-metsa-client-ip': '203.0.113.250',
        'user-agent': 'Mozilla/5.0',
      },
    }),
    { ip: '203.0.113.251' },
  );

  expect(info.ip).toEqual(CLIENT);
  expect(info.country).toEqual('DE');
  delete (globalThis as Record<string, unknown>).maxmind;
});

test('getLocation: returns null for malformed ip', async () => {
  await expect(
    getLocation(
      'not-an-ip',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual(null);
});

test('getLocation: treats localhost check errors as non-local', async () => {
  isLocalhost.default.mockRejectedValue(new Error('DNS Lookup failed.'));

  await expect(
    getLocation(
      '8.8.8.8',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual({
    country: 'US',
    region: 'US-CA',
    city: 'Los Angeles',
  });
});

test('hasBlockedIp: returns false for malformed client ip with cidr block', () => {
  process.env.IGNORE_IP = '10.0.0.0/8';

  expect(hasBlockedIp('not-an-ip')).toBe(false);
});
