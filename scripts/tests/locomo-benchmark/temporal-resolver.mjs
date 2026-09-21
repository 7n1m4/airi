import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from 'date-fns'

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
 * Parse LoCoMo date string into ISO-compatible date string.
 * Handles formats like: "3:47 pm on 17 March, 2022" -> "March 17, 2022 15:47:00"
 *
 * @param {string} str
 * @returns {string|null}
 */
export function parseLoCoMoDateTime(str) {
  if (!str)
    return null
  const match = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*on\s*(\d{1,2})\s*([A-Z]+),?\s*(\d{4})/i)
  if (match) {
    const [_, h, m, meridiem, d, month, y] = match
    let hour = Number.parseInt(h, 10)
    if (meridiem.toLowerCase() === 'pm' && hour < 12)
      hour += 12
    if (meridiem.toLowerCase() === 'am' && hour === 12)
      hour = 0
    const padHour = String(hour).padStart(2, '0')
    const padDay = String(d).padStart(2, '0')
    return `${month} ${padDay}, ${y} ${padHour}:${m}:00`
  }
  return str
}

/**
 * Resolves a temporal expression relative to a session timestamp using calendar arithmetic.
 *
 * @param {string} rawExpression - e.g. "last week", "three days ago", "yesterday"
 * @param {string|Date} anchorDateInput - e.g. "2022-04-12T09:52:00" or "3:47 pm on 17 March, 2022"
 * @param {string} [turnId]
 * @returns {object|null}
 */
export function resolveTemporalExpression(rawExpression, anchorDateInput, turnId = null) {
  if (!rawExpression || !anchorDateInput)
    return null

  const raw = rawExpression.trim().toLowerCase()
  const cleanAnchor = typeof anchorDateInput === 'string'
    ? (parseLoCoMoDateTime(anchorDateInput) || anchorDateInput)
    : anchorDateInput
  const anchor = new Date(cleanAnchor)
  if (Number.isNaN(anchor.getTime()))
    return null

  // 1. "last week"
  if (raw.includes('last week')) {
    // Previous Monday-Sunday calendar week via date-fns
    const prevWeek = subWeeks(anchor, 1)
    const prevWeekMonday = startOfWeek(prevWeek, { weekStartsOn: 1 })
    const prevWeekSunday = endOfWeek(prevWeek, { weekStartsOn: 1 })
    const formattedLabel = formatWeekOfMonth(prevWeekMonday)

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: format(anchor, 'yyyy-MM-dd'),
      kind: 'interval',
      precision: 'week',
      start: format(prevWeekMonday, 'yyyy-MM-dd'),
      end_inclusive: format(prevWeekSunday, 'yyyy-MM-dd'),
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
    const targetDate = subDays(anchor, days)
    const formatted = format(targetDate, 'MMMM d, yyyy')

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: format(anchor, 'yyyy-MM-dd'),
      kind: 'point',
      precision: 'day',
      date: format(targetDate, 'yyyy-MM-dd'),
      formatted_label: formatted, // "April 26, 2022"
      policy: 'calendar_days_subtraction_v1',
      ambiguous: false,
    }
  }

  // 3. "yesterday"
  if (raw.includes('yesterday')) {
    const targetDate = subDays(anchor, 1)
    const formatted = format(targetDate, 'MMMM d, yyyy')

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: format(anchor, 'yyyy-MM-dd'),
      kind: 'point',
      precision: 'day',
      date: format(targetDate, 'yyyy-MM-dd'),
      formatted_label: formatted,
      policy: 'calendar_yesterday_subtraction_v1',
      ambiguous: false,
    }
  }

  // 4. "last month"
  if (raw.includes('last month')) {
    const prevMonth = subMonths(anchor, 1)
    const prevMonthStart = startOfMonth(prevMonth)
    const prevMonthEnd = endOfMonth(prevMonth)
    const formatted = format(prevMonth, 'MMMM yyyy')

    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: format(anchor, 'yyyy-MM-dd'),
      kind: 'interval',
      precision: 'month',
      start: format(prevMonthStart, 'yyyy-MM-dd'),
      end_inclusive: format(prevMonthEnd, 'yyyy-MM-dd'),
      formatted_label: formatted,
      policy: 'calendar_last_month_v1',
      ambiguous: false,
    }
  }

  // 5. "last year"
  if (raw.includes('last year')) {
    const prevYear = anchor.getFullYear() - 1
    return {
      raw_expression: rawExpression,
      anchor_turn_id: turnId,
      anchor_date: format(anchor, 'yyyy-MM-dd'),
      kind: 'interval',
      precision: 'year',
      start: `${prevYear}-01-01`,
      end_inclusive: `${prevYear}-12-31`,
      formatted_label: `In ${prevYear}`,
      policy: 'calendar_last_year_v1',
      ambiguous: false,
    }
  }

  // 4. "in April 2022" / "in April"
  const monthMatch = raw.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/i)
  if (monthMatch) {
    const mName = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1).toLowerCase()
    const anchorYear = anchor.getFullYear()
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
