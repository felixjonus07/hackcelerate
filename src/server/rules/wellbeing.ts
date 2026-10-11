/**
 * Wellbeing patterns (§14.2), deliberately narrow: three behavioural patterns, no diagnosis, no
 * inference about health, no free text. A pattern produces a recovery nudge for the student (which
 * names the pattern) and a soft note to the mentor. It never produces a persona or a risk label.
 * Pure: the caller passes the events, the date and the thresholds.
 */
import { type Calendar, localDate } from "./calendar";

export interface ActivityEvent {
  at: Date;
  /** login | current_affairs | practice | mock */
  kind: string;
  items?: number;
}

export type WellbeingPattern = "late_night" | "volume_spike" | "activity_stop";

export interface Nudge {
  pattern: WellbeingPattern;
  /** The counts behind the nudge, in words the student can read. */
  explanation: string;
}

export interface WellbeingThresholds {
  late_night_sessions_nights: number;
  late_night_window_days: number;
  late_night_start_hour: number;
  late_night_end_hour: number;
  mock_volume_spike_pct: number;
  spike_min_previous_mocks: number;
  attendance_drop_points: number;
  activity_stop_days: number;
  heavy_use_min_events: number;
}

const STUDY = new Set(["current_affairs", "practice", "mock"]);
const MOCKS = new Set(["practice", "mock"]);

const localHour = (at: Date, cal: Pick<Calendar, "utc_offset_minutes">) =>
  new Date(at.getTime() + cal.utc_offset_minutes * 60_000).getUTCHours();

export function detectWellbeing(input: {
  events: readonly ActivityEvent[];
  /** Weekly attendance percentages, oldest first. */
  attendanceWeekly: readonly { week: number; value: number }[];
  asOf: Date;
  calendar: Calendar;
  thresholds: WellbeingThresholds;
}): Nudge[] {
  const { events, asOf, calendar: cal, thresholds: t } = input;
  const nudges: Nudge[] = [];
  const dayMs = 86_400_000;
  const within = (e: ActivityEvent, fromDaysAgo: number, toDaysAgo: number) => {
    const age = (asOf.getTime() - e.at.getTime()) / dayMs;
    return age >= toDaysAgo && age < fromDaysAgo;
  };

  // 1. Study sessions clustered after midnight on five or more nights in a two-week period.
  const nights = new Set(
    events
      .filter((e) => STUDY.has(e.kind) && within(e, t.late_night_window_days, 0))
      .filter((e) => {
        const h = localHour(e.at, cal);
        return h >= t.late_night_start_hour && h < t.late_night_end_hour;
      })
      .map((e) => localDate(e.at, cal)),
  );
  if (nights.size >= t.late_night_sessions_nights)
    nudges.push({
      pattern: "late_night",
      explanation: `You studied after midnight on ${nights.size} of the last ${t.late_night_window_days} nights.`,
    });

  // 2. Mock volume more than doubling in a week, with attendance down by 10 points or more over the same weeks.
  const mocks = events.filter((e) => MOCKS.has(e.kind));
  const thisWeek = mocks.filter((e) => within(e, 7, 0)).length;
  const lastWeek = mocks.filter((e) => within(e, 14, 7)).length;
  const att = input.attendanceWeekly.slice(-3);
  const drop = att.length >= 2 ? att[0].value - att[att.length - 1].value : 0;
  if (
    lastWeek >= t.spike_min_previous_mocks &&
    thisWeek > lastWeek * (1 + t.mock_volume_spike_pct / 100) &&
    drop >= t.attendance_drop_points
  )
    nudges.push({
      pattern: "volume_spike",
      explanation: `Practice sets went from ${lastWeek} to ${thisWeek} in a week while attendance fell by ${Math.round(drop)} points.`,
    });

  // 3. A complete stop for 14 days after a period of heavy use.
  const recent = events.filter((e) => within(e, t.activity_stop_days, 0)).length;
  const before = events.filter((e) => within(e, t.activity_stop_days * 3, t.activity_stop_days)).length;
  if (recent === 0 && before >= t.heavy_use_min_events)
    nudges.push({
      pattern: "activity_stop",
      explanation: `There has been no activity for ${t.activity_stop_days} days after a busy stretch of ${before} sessions.`,
    });

  return nudges;
}

/** Student-facing wording for a pattern: gentle, no label, and always pointing to campus support (§14.2). */
export const NUDGE_TITLE: Record<WellbeingPattern, string> = {
  late_night: "A lot of late-night study lately",
  volume_spike: "A big jump in practice this week",
  activity_stop: "A quiet couple of weeks",
};
