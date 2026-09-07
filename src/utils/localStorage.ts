// ─── Storage Usage ───────────────────────────────────────────────

/**
 * Returns the total number of UTF-8 bytes stored in localStorage.
 * Uses TextEncoder for accurate multi-byte measurement (R34.7).
 */
export function getLocalStorageUsageBytes(): number {
  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      if (value) {
        totalBytes += encoder.encode(key).length + encoder.encode(value).length;
      }
    }
  }
  return totalBytes;
}

/** Formats a byte count into a human-readable string (B, KB, or MB). */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}