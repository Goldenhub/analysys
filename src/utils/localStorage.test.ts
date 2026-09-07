import { describe, it, expect, beforeEach } from 'vitest';
import { getLocalStorageUsageBytes, formatStorageSize } from './localStorage';

// ─── Tests ───────────────────────────────────────────────────────

describe('getLocalStorageUsageBytes (UTF-8 measurement)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 0 for empty localStorage', () => {
    expect(getLocalStorageUsageBytes()).toBe(0);
  });

  it('calculates correct UTF-8 bytes for ASCII content', () => {
    localStorage.setItem('key1', 'value1');
    // ASCII: 1 byte per character
    const expected =
      new TextEncoder().encode('key1').length + new TextEncoder().encode('value1').length;
    expect(getLocalStorageUsageBytes()).toBe(expected);
  });

  it('measures multi-byte characters accurately (Task 425)', () => {
    // '日本語' is 3 characters, each 3 bytes in UTF-8 = 9 bytes for the value
    localStorage.setItem('key', '日本語');
    const expectedKeyBytes = new TextEncoder().encode('key').length;
    const expectedValueBytes = new TextEncoder().encode('日本語').length;
    expect(getLocalStorageUsageBytes()).toBe(expectedKeyBytes + expectedValueBytes);
    // Verify it's more than the naive length-based approach would give
    expect(expectedValueBytes).toBeGreaterThan('日本語'.length);
  });
});

describe('formatStorageSize', () => {
  it('formats bytes', () => {
    expect(formatStorageSize(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatStorageSize(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatStorageSize(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});