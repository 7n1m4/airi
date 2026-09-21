/**
 * Deterministic Temporal Resolver for LoCoMo Dialogue Turns.
 * Anchors relative time expressions to source session dates and computes intervals.
 * Follows the peer-reviewed specification in docs/memory_lab/LoCoMo-Pass2-Entity-Ledger-Review.md §5.
 */

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Format a Date object into "Month Day, Year" or "first/second/third/fourth week of Month Year".
 */
export function formatWeekOfMonth(date) {
  const day = date.getDate()
  const month = MONTH_NAMES[date.getMonth()]
  const year = date.getFullYear()

  if (day <= 7)
    return `first week of ${month} ${year}`
  if (day <= 14)
    return `second week of ${month} ${year}`
  if (day <= 21)
    return `third week of ${month} ${year}`
  return `fourth week of ${month} ${year}`
}

/**
 * Resolves a temporal expression relative to a session timestamp.
 *
 * @param {string} rawExpression - e.g. "last week", "three days ago", "yesterday"
 * @param {string|Date} anchorDateInput - e.g. "2022-04-12T09:52:00"
 * @param {string} [turnId]
 * @returns {object|null}
 */
export function resolveTemporalExpression(rawExpression, anchorDateInput, turnId = null) {
  if (!rawExpression || !anchorDateInput)
    return null

  const raw = rawExpression.trim().toLowerCase()
  const anchor = new Date(anchorDateInput)
  if (isNaN(anchor.getTime()))
    return null

  const anchorYear = anchor.getFullYear()
  const anchorMonth = anchor.getMonth()
  const anchorDay = anchor.getDate()

  // 1. "last week"
  if (raw.includes('last week')) {
    // Previous Monday-Sunday calendar week
    const dayOfWeek = anchor.getDay() // 0 is Sunday, 1 is Monday...
    const daysSinceLastMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const currentWeekMonday = new Date(anchorYear, anchorMonth, anchorDay - daysSinceLastMonday)
    const prevWeekMonday = new Date(currentWeekMonday.getTime() - 7 * 86400000)
    const prevWeekSunday = new Date(currentWeekMonday.getTime() - 86400000)

    const formattedLabel = formatWeekOfMonth(prevWeekMonday)

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: anchor.toISOString().split('T')[0],
      kind: 'interval',
      precision: 'week',
      start: prevWeekMonday.toISOString().split('T')[0],
      end_inclusive: prevWeekSunday.toISOString().split('T')[0],
      formatted_label: formattedLabel, // "first week of April 2022"
      policy: 'previous_calendar_week_monday_start_v1',
      ambiguous: true,
    }
  }

  // 2. "three days ago" / "N days ago"
  const daysAgoMatch = raw.match(/(\d+|one|two|three|four|five|six|seven)\s+days?\s+ago/)
  if (daysAgoMatch) {
    const numMap = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }
    const days = numMap[daysAgoMatch[1]] || Number.parseInt(daysAgoMatch[1], 10) || 3
    const targetDate = new Date(anchor.getTime() - days * 86400000)
    const targetIso = targetDate.toISOString().split('T')[0]
    const month = MONTH_NAMES[targetDate.getMonth()]
    const formatted = `${month} ${targetDate.getDate()}, ${targetDate.getFullYear()}`

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: anchor.toISOString().split('T')[0],
      kind: 'point',
      precision: 'day',
      date: targetIso,
      formatted_label: formatted, // "April 26, 2022"
      policy: 'exact_days_subtraction_v1',
      ambiguous: false,
    }
  }

  // 3. "yesterday"
  if (raw.includes('yesterday')) {
    const targetDate = new Date(anchor.getTime() - 86400000)
    const targetIso = targetDate.toISOString().split('T')[0]
    const month = MONTH_NAMES[targetDate.getMonth()]
    const formatted = `${month} ${targetDate.getDate()}, ${targetDate.getFullYear()}`

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: anchor.toISOString().split('T')[0],
      kind: 'point',
      precision: 'day',
      date: targetIso,
      formatted_label: formatted,
      policy: 'yesterday_subtraction_v1',
      ambiguous: false,
    }
  }

  // 4. "in April 2022" / "in April"
  const monthMatch = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/i)
  if (monthMatch) {
    const mName = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1).toLowerCase()
    const yr = monthMatch[2] || anchorYear
    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: anchor.toISOString().split('T')[0],
      kind: 'interval',
      precision: 'month',
      formatted_label: `${mName} ${yr}`,
      policy: 'named_month_v1',
      ambiguous: false,
    }
  }

  return {
    raw_expression: rawExpression,
    anchor_turn_id: turnId,
    anchor_date: anchor.toISOString().split('T')[0],
    kind: 'unknown',
    formatted_label: rawExpression,
    policy: 'unresolved_raw_v1',
    ambiguous: true,
  }
}
