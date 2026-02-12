/**
 * Convert American odds to Decimal odds
 * @param {number} american - American odds (e.g., -110, +150)
 * @returns {number} Decimal odds (e.g., 1.909, 2.500)
 */
function americanToDecimal(american) {
  if (american >= 0) {
    return +(american / 100 + 1).toFixed(3);
  }
  return +(100 / Math.abs(american) + 1).toFixed(3);
}

/**
 * Convert Decimal odds to American odds
 * @param {number} decimal - Decimal odds (e.g., 1.909, 2.500)
 * @returns {number} American odds (e.g., -110, +150)
 */
function decimalToAmerican(decimal) {
  if (decimal >= 2.0) {
    return Math.round((decimal - 1) * 100);
  }
  return Math.round(-100 / (decimal - 1));
}

/**
 * Format American odds with sign
 * @param {number} odds - American odds
 * @returns {string} Formatted odds (e.g., "-110", "+150")
 */
function formatOdds(odds) {
  if (odds >= 0) return `+${odds}`;
  return `${odds}`;
}

/**
 * Calculate payout from American odds and units
 * @param {number} american - American odds
 * @param {number} units - Units wagered
 * @returns {number} Potential profit in units
 */
function calculatePayout(american, units) {
  if (american >= 0) {
    return +(units * (american / 100)).toFixed(2);
  }
  return +(units * (100 / Math.abs(american))).toFixed(2);
}

/**
 * Format a spread value with sign
 * @param {number} spread
 * @returns {string}
 */
function formatSpread(spread) {
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

/**
 * Truncate string if too long
 */
function truncate(str, max = 100) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

module.exports = {
  americanToDecimal,
  decimalToAmerican,
  formatOdds,
  calculatePayout,
  formatSpread,
  truncate,
};
