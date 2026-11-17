import { afterEach, describe, expect, test, vi } from 'vitest';
import { getClientIp, getIpAddress, stripPort } from './ip';

function headers(init: Record<string, string>) {
  return new Headers(init);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// metsa: Envoy Gateway appends the address it accepted the connection from
// as the last X-Forwarded-For entry; every other entry and header is the
// client's to write.
const CLIENT = '89.167.61.215';

describe('getIpAddress', () => {
  test('returns undefined without x-forwarded-for', () => {
    expect(getIpAddress(headers({}))).toBeUndefined();
  });

  test("takes the gateway's last x-forwarded-for entry", () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': CLIENT }))).toBe(CLIENT);
  });

  test('ignores a forged first x-forwarded-for entry', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': ` 198.51.100.250 , ${CLIENT} ` }))).toBe(
      CLIENT,
    );
  });

  test('skips pod network, private and loopback entries after it', () => {
    expect(
      getIpAddress(
        headers({ 'x-forwarded-for': `198.51.100.250,${CLIENT}, 100.64.2.112, 10.0.0.1, ::1` }),
      ),
    ).toBe(CLIENT);
  });

  test('never reads a header a client can set', () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'x-metsa-client-ip');
    for (const name of [
      'x-metsa-client-ip',
      'true-client-ip',
      'cf-connecting-ip',
      'fastly-client-ip',
      'x-real-ip',
      'forwarded',
    ]) {
      const value = name === 'forwarded' ? 'for=203.0.113.250' : '203.0.113.250';
      expect(getIpAddress(headers({ [name]: value, 'x-forwarded-for': CLIENT })), name).toBe(
        CLIENT,
      );
      expect(getIpAddress(headers({ [name]: value })), name).toBeUndefined();
    }
  });

  test('normalizes a full IPv6 address to compressed form', () => {
    expect(
      getIpAddress(headers({ 'x-forwarded-for': '2001:0db8:0000:0000:0000:0000:0000:0001' })),
    ).toBe('2001:db8::1');
  });

  test('converts an IPv4-mapped IPv6 address to IPv4', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': `::ffff:${CLIENT}` }))).toBe(CLIENT);
  });

  test('strips the port from an IPv4 address with a port', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': `${CLIENT}:8080` }))).toBe(CLIENT);
  });

  test('trusts nothing when the last entry is no address', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': `${CLIENT}, not-an-ip` }))).toBeUndefined();
  });

  test('returns the first entry when every entry is internal', () => {
    expect(getIpAddress(headers({ 'x-forwarded-for': '10.0.0.1, 100.64.2.112' }))).toBe('10.0.0.1');
  });
});

describe('stripPort', () => {
  test('returns nullish input unchanged', () => {
    expect(stripPort(undefined)).toBeUndefined();
    expect(stripPort(null)).toBeNull();
    expect(stripPort('')).toBe('');
  });

  test('removes the port from an IPv4 address', () => {
    expect(stripPort('1.2.3.4:8080')).toBe('1.2.3.4');
  });

  test('leaves a plain IPv4 address unchanged', () => {
    expect(stripPort('1.2.3.4')).toBe('1.2.3.4');
  });

  test('keeps only the bracketed portion of a bracketed IPv6 address', () => {
    expect(stripPort('[::1]:8080')).toBe('[::1]');
  });

  test('leaves an unbracketed IPv6 address unchanged', () => {
    expect(stripPort('::1')).toBe('::1');
  });
});

describe('getClientIp', () => {
  test('through the gateway: the gateway entry, never payload.ip', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' });
    expect(getClientIp(headers, '192.0.2.55')).toBe('198.51.100.7');
  });

  test('through the gateway with no usable entry: no address, payload.ip ignored', () => {
    const headers = new Headers({ 'x-forwarded-for': 'junk' });
    expect(getClientIp(headers, '192.0.2.55')).toBeUndefined();
  });

  test('from inside the cluster: payload.ip, as the api forwarder sends it', () => {
    expect(getClientIp(new Headers(), '192.0.2.55')).toBe('192.0.2.55');
    expect(getClientIp(new Headers(), '2001:db8::7')).toBe('2001:db8::7');
  });

  test('from inside the cluster with no valid payload.ip: no address', () => {
    expect(getClientIp(new Headers(), undefined)).toBeUndefined();
    expect(getClientIp(new Headers(), 'not-an-ip')).toBeUndefined();
  });
});
