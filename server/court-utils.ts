/**
 * Utility functions for court metadata processing
 */

export type CourtLevel = 'Hoge Raad' | 'Gerechtshof' | 'Rechtbank' | 'Overig';

/**
 * Determine court level from court name
 * 
 * Examples:
 * - "Hoge Raad" → "Hoge Raad"
 * - "Gerechtshof Amsterdam" → "Gerechtshof"
 * - "Gerechtshof 's-Hertogenbosch" → "Gerechtshof"
 * - "Rechtbank Den Haag" → "Rechtbank"
 * - "Rechtbank Midden-Nederland" → "Rechtbank"
 * - "Raad van State" → "Overig"
 * - "Parket bij de Hoge Raad" → "Overig"
 */
export function detectCourtLevel(courtName: string): CourtLevel {
  if (!courtName) {
    return 'Overig';
  }

  const normalized = courtName.toLowerCase().trim();

  // Check for Hoge Raad (including "Hoge Raad der Nederlanden")
  // But exclude "Parket bij de Hoge Raad" (Public Prosecution)
  if (normalized.includes('hoge raad') && !normalized.includes('parket bij')) {
    return 'Hoge Raad';
  }

  // Check for Gerechtshof (any variant)
  if (normalized.includes('gerechtshof')) {
    return 'Gerechtshof';
  }

  // Check for Rechtbank
  if (normalized.includes('rechtbank')) {
    return 'Rechtbank';
  }

  // Everything else (Raad van State, Parket, etc.)
  return 'Overig';
}

/**
 * Add court level to a record that has a court field
 */
export function addCourtLevel<T extends { court: string }>(record: T): T & { courtLevel: CourtLevel } {
  return {
    ...record,
    courtLevel: detectCourtLevel(record.court),
  };
}
