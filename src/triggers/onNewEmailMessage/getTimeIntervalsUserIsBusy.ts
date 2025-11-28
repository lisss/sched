import { CalendarEvent, TimeInterval } from "../../types/CalendarEvent";
import { addWeeks, areIntervalsOverlapping } from "date-fns";

const withNormalizedEmail = (email: string): string =>
  email.trim().toLowerCase();

const isWithinNextTwoWeeks = (start: Date, end: Date, now: Date): boolean => {
  const windowEnd = addWeeks(now, 2);
  return end >= now && start <= windowEnd;
};

const isUserReferenced = (event: CalendarEvent, userEmail: string): boolean => {
  const normalizedUserEmail = withNormalizedEmail(userEmail);
  return (
    withNormalizedEmail(event.organiser.emailAddress) === normalizedUserEmail ||
    event.invitees
      .map((invitee) => withNormalizedEmail(invitee.emailAddress))
      .includes(normalizedUserEmail)
  );
};

const isAllDayBusy = (title: string): boolean => {
  const lowerTitle = title.toLowerCase();
  return lowerTitle.includes("ooo") || lowerTitle.includes("out of office");
};

const userHasAcceptedInvite = (
  event: CalendarEvent,
  userEmail: string
): boolean =>
  event.invitees.some(
    (invitee) =>
      withNormalizedEmail(invitee.emailAddress) ===
        withNormalizedEmail(userEmail) &&
      ["ACCEPTED", "TENTATIVE", "PENDING"].includes(invitee.attendanceDecision)
  );

const userIsEffectiveOrganiser = (
  event: CalendarEvent,
  userEmail: string
): boolean => {
  const eventOrganiser = withNormalizedEmail(event.organiser.emailAddress);
  const normalizedUserEmail = withNormalizedEmail(userEmail);
  if (eventOrganiser !== normalizedUserEmail) {
    return false;
  }

  const inviteesExcludingOrganiser = event.invitees.filter(
    (invitee) => withNormalizedEmail(invitee.emailAddress) !== eventOrganiser
  );

  if (inviteesExcludingOrganiser.length === 0) {
    return true;
  }

  const everyoneDeclined = inviteesExcludingOrganiser.every(
    (invitee) => invitee.attendanceDecision === "DECLINED"
  );

  return !everyoneDeclined;
};

const mergeIntervals = (intervals: TimeInterval[]): TimeInterval[] =>
  intervals
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .reduce<TimeInterval[]>((acc, interval) => {
      if (acc.length === 0) {
        return [interval];
      }

      const lastInterval = acc[acc.length - 1];
      const overlaps = areIntervalsOverlapping(
        { start: lastInterval.startsAt, end: lastInterval.endsAt },
        { start: interval.startsAt, end: interval.endsAt }
      );

      if (!overlaps) {
        return [...acc, interval];
      }

      const mergedInterval: TimeInterval = {
        startsAt: lastInterval.startsAt,
        endsAt:
          lastInterval.endsAt.getTime() >= interval.endsAt.getTime()
            ? lastInterval.endsAt
            : interval.endsAt,
      };

      return [...acc.slice(0, -1), mergedInterval];
    }, []);

export const getTimeIntervalsUserIsBusy = (
  eventsFromUsersCalendar: CalendarEvent[],
  userEmail: string
): TimeInterval[] => {
  const now = new Date();

  const busyIntervals = eventsFromUsersCalendar
    .filter((event) => isUserReferenced(event, userEmail))
    .filter((event) => isWithinNextTwoWeeks(event.startsAt, event.endsAt, now))
    .filter((event) => {
      if (event.isAllDay) {
        return isAllDayBusy(event.title);
      }

      return (
        userHasAcceptedInvite(event, userEmail) ||
        userIsEffectiveOrganiser(event, userEmail)
      );
    })
    .map<TimeInterval>((event) => ({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    }));

  return mergeIntervals(busyIntervals);
};
