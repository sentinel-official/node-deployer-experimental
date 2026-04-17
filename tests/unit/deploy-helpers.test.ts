import { describe, expect, it } from 'vitest';
import { stripToHost } from '../../src/main/services/deploy';

describe('stripToHost', () => {
  it('passes through bare IPv4', () => {
    expect(stripToHost('104.238.156.213')).toBe('104.238.156.213');
  });
  it('strips scheme', () => {
    expect(stripToHost('http://104.238.156.213')).toBe('104.238.156.213');
    expect(stripToHost('https://example.com')).toBe('example.com');
  });
  it('strips scheme + port + trailing slash', () => {
    expect(stripToHost('http://104.238.156.213:7777/')).toBe('104.238.156.213');
  });
  it('strips plain host:port', () => {
    expect(stripToHost('node.example.com:7777')).toBe('node.example.com');
  });
  it('unwraps bracketed IPv6 with port', () => {
    expect(stripToHost('[2001:db8::1]:7777')).toBe('2001:db8::1');
  });
  it('tolerates leading/trailing whitespace', () => {
    expect(stripToHost('  example.com:7777 ')).toBe('example.com');
  });
  it('returns empty for empty input', () => {
    expect(stripToHost('')).toBe('');
  });
});
