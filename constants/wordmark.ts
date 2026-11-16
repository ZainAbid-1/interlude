/**
 * Sizing for the "INTERLUDE." wordmark (Antonio font).
 *
 * Measured: "INTERLUDE." is 4.01 em wide in Antonio. 4.1 leaves a small
 * safety margin for platform font rendering differences.
 */
export const WORDMARK_TEXT = 'INTERLUDE.';
const EM_WIDTH = 4.1;

/** Largest font size (capped at `max`) at which the wordmark fits `availableWidth`. */
export function wordmarkFontSize(availableWidth: number, letterSpacing: number, max: number): number {
  const spacing = letterSpacing * WORDMARK_TEXT.length;
  return Math.max(18, Math.min(max, Math.floor((availableWidth - spacing) / EM_WIDTH)));
}
