import { describe, expect, it } from 'vitest';
import { controlUrl, hostBaseUri, hostUrl, normalizeBaseUri } from '../src/endpoint';

describe('normalizeBaseUri', () => {
  it('defaults a bare hostname to https', () => {
    expect(normalizeBaseUri('plandrop.example.com')).toBe('https://plandrop.example.com');
  });

  it('preserves an explicit http URI with port', () => {
    expect(normalizeBaseUri('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('preserves an explicit https URI with port', () => {
    expect(normalizeBaseUri('https://plandrop.example.com:8443')).toBe(
      'https://plandrop.example.com:8443',
    );
  });

  it('throws on an unparseable value', () => {
    expect(() => normalizeBaseUri('http://')).toThrow();
  });
});

describe('controlUrl', () => {
  it('joins the base origin with an api path', () => {
    expect(controlUrl('https://plandrop.example.com', '/api/hosts')).toBe(
      'https://plandrop.example.com/api/hosts',
    );
  });
});

describe('hostBaseUri / hostUrl', () => {
  it('prepends the host label as a subdomain, preserving scheme', () => {
    expect(hostBaseUri('https://plandrop.example.com', 'abc')).toBe('https://abc.plandrop.example.com');
    expect(hostUrl('https://plandrop.example.com', 'abc')).toBe('https://abc.plandrop.example.com/');
  });

  it('preserves the port when present', () => {
    expect(hostBaseUri('http://localhost:8080', 'abc')).toBe('http://abc.localhost:8080');
    expect(hostUrl('http://localhost:8080', 'abc')).toBe('http://abc.localhost:8080/');
  });
});
