import { TimeWindowConfig } from '../../lib/config/configuration.types';

/**
 * Determines whether a deployment is allowed at the given timestamp
 * based on the time window configuration.
 *
 * Returns `false` (deployment blocked) if ANY of these conditions are true:
 * 1. The timestamp falls on a weekend (Saturday or Sunday) in the configured timezone
 * 2. The timestamp's date matches any date in the holidays array (ISO YYYY-MM-DD)
 * 3. The timestamp's hour falls within blocked hours in the configured timezone
 *
 * Blocked hours logic:
 * - Overnight window (start > end, e.g. 18–6): blocked if hour >= start OR hour < end
 * - Daytime window (start < end, e.g. 9–17): blocked if hour >= start AND hour < end
 * - No window (start === end): no hours are blocked
 *
 * @param timestamp - The current time as a Date object
 * @param config - Time window configuration (timezone, blocked hours, holidays)
 * @returns true if deployment is allowed, false if blocked
 */
export function isDeploymentAllowed(timestamp: Date, config: TimeWindowConfig): boolean {
  const { timezone, blockedHourStart, blockedHourEnd, holidays } = config;

  // Use Intl.DateTimeFormat to get locale-aware date components in the configured timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(timestamp);
  const get = (type: string): string => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };

  const hour = parseInt(get('hour'), 10);
  const weekday = get('weekday'); // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
  const year = get('year');
  const month = get('month');
  const day = get('day');

  // 1. Check weekend (Saturday or Sunday)
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false;
  }

  // 2. Check holidays — compare ISO date string (YYYY-MM-DD)
  const dateStr = `${year}-${month}-${day}`;
  if (holidays.includes(dateStr)) {
    return false;
  }

  // 3. Check blocked hours
  if (blockedHourStart !== blockedHourEnd) {
    if (blockedHourStart > blockedHourEnd) {
      // Overnight window (e.g., 18–6): blocked if hour >= 18 OR hour < 6
      if (hour >= blockedHourStart || hour < blockedHourEnd) {
        return false;
      }
    } else {
      // Daytime window (e.g., 9–17): blocked if hour >= 9 AND hour < 17
      if (hour >= blockedHourStart && hour < blockedHourEnd) {
        return false;
      }
    }
  }
  // When blockedHourStart === blockedHourEnd, no hours are blocked

  return true;
}

/**
 * Lambda handler that evaluates the current time against the deployment
 * window configuration and returns whether deployment is allowed.
 *
 * Environment variables:
 * - TIMEZONE: IANA timezone string (e.g., 'America/Los_Angeles')
 * - BLOCKED_HOUR_START: Start of blocked hours (0–23)
 * - BLOCKED_HOUR_END: End of blocked hours (0–23)
 * - HOLIDAYS: JSON-encoded string array of ISO date strings
 */
export async function handler(): Promise<{
  statusCode: number;
  body: string;
}> {
  const config: TimeWindowConfig = {
    timezone: process.env.TIMEZONE ?? 'America/Los_Angeles',
    blockedHourStart: parseInt(process.env.BLOCKED_HOUR_START ?? '18', 10),
    blockedHourEnd: parseInt(process.env.BLOCKED_HOUR_END ?? '6', 10),
    holidays: JSON.parse(process.env.HOLIDAYS ?? '[]'),
  };

  const now = new Date();
  const allowed = isDeploymentAllowed(now, config);

  const reason = allowed
    ? 'Deployment is within the allowed time window'
    : 'Deployment is outside the allowed time window (blocked hours, weekend, or holiday)';

  const body = JSON.stringify({
    allowed,
    reason,
    timestamp: now.toISOString(),
  });

  return {
    statusCode: 200,
    body,
  };
}
