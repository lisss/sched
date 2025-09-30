import { CalendarEvent, TimeInterval } from "../../types/CalendarEvent";
import {
  // parseISO,
  // addDays,
  // startOfDay,
  // max,
  // min,
  // addHours,
  // startOfWeek,
  // isWeekend,
  // getHours,
  // getMinutes,
  // differenceInMinutes,
  // addBusinessDays,
  // startOfMinute,
  addWeeks,
  // addMinutes,
  areIntervalsOverlapping,
  // endOfDay,
} from "date-fns";

// import {
//   // UTC => local
//   toZonedTime,
//   // local => UTC
//   fromZonedTime,
// } from "date-fns-tz";

export const getTimeIntervalsUserIsBusy = (
  eventsFromUsersCalendar: CalendarEvent[],
  userEmail: string
): TimeInterval[] => {
  // Filter for events in the next two weeks that the user is busy for

  // What makes a user busy:
  // 1. If they organised the event* (but see 5)
  // 2. If calendar invitee decision is accepted or tentative. This will change based on how we use this function, but given limited
  // information, go with just this
  // 3. If all day event, parse title, OOO is busy, but work in shoreditch is probably not busy. Unclear how this function is called and what perf requirements exist here,
  // which decides whether we use an LLM or just some heuristics. For now, let's stick to heuristics. Specially given signature is non-async, suggesting local compute no IO type fn.
  // 4. Handle times as well, let's just assume no timezone schenanigans, since we have no info of user timezones, everything is in ~~local time~~ types mention UTC, assume everything is UTC.
  // 5. Only two invitees, and other invitee has declined, then shouldn't be busy..
       // doesn't need to be only two, can be hundreds, as long as everyone else has declined, user is not busy?

  // We don't know the time reference, since it appears like sample events are from 2024, so next two weeks from 'now' doesn't really work.
  // looks like this is updated programmatically when run 👀

  const now = new Date();
  
  // emails are case insensitive
  const eventsReferencingUser =  eventsFromUsersCalendar.filter(event => {
    return event.organiser.emailAddress.toLowerCase() === userEmail.toLowerCase() || event.invitees.map(invitee => invitee.emailAddress.toLowerCase()).includes(userEmail.toLowerCase()) 
  })

  // filter to events in the next two weeks
  .filter(event => {
    return event.endsAt >= now && event.startsAt <= addWeeks(now, 2)
  })

  const busyEvents = eventsReferencingUser.filter((event) => {
    // TODO: Create compare fn for emails to refactor everywhere here

    // Case 2: All day event, and title has OOO or out of office => busy
    if (event.isAllDay) {
      const titleLower = event.title.toLowerCase();
      if (titleLower.includes("ooo") || titleLower.includes("out of office")) {
        return true;
      } else {
        return false;
      }
    }

    // Case 3: User is invitee and has not declined => busy
    const userIsInviteeAndNotDeclined = event.invitees.some(
      (invitee) =>
        invitee.emailAddress.toLowerCase() === userEmail.toLowerCase() &&
        (invitee.attendanceDecision === "ACCEPTED" ||
          invitee.attendanceDecision === "TENTATIVE" ||
          invitee.attendanceDecision === "PENDING")
    );
    if (userIsInviteeAndNotDeclined) {
      return true;
    }

    // Case 4: User is organiser and not everyone has declined, or no invitees at all (self-block)
    const filteredInvitees = event.invitees.filter(invitee => invitee.emailAddress.toLowerCase() != event.organiser.emailAddress.toLowerCase())
    const isUserOrganiser =
      event.organiser.emailAddress.toLowerCase() === userEmail.toLowerCase();
    const responses = filteredInvitees.map(
      (invitee) => invitee.attendanceDecision
    );
    const everyoneDeclined =
      responses.length > 0 &&
      responses.every((decision) => decision === "DECLINED");
    if (isUserOrganiser && !everyoneDeclined) {
      return true;
    }

    if (isUserOrganiser && filteredInvitees.length === 0) {
      return true;
    }

    // default to not busy
    return false;

    // TODO: Product wise, is this enough? Do we want to take into consideration any other user preferences while determining busy status?
    // e.g. also fallback to LLM for an event and pass in any user preferences they've told us in plain text about what to treat as busy
    // e.g. "I want to treat all day events as busy unless the title has 'work in shoreditch' or 'lunch with' in it"
    // or "I want to treat all events outside working hours as not busy, unless the title has 'important' in it"

    // Case 1: User is invitee and has declined => not busy --> not necessary to make explicit, since default is false
    // const userIsInviteeAndDeclined = event.invitees.some(
    //   (invitee) =>
    //     invitee.emailAddress.toLowerCase() === userEmail.toLowerCase() &&
    //     invitee.attendanceDecision === "DECLINED"
    // );
    // if (userIsInviteeAndDeclined) {
    //   return false;
    // }
  });

  // map to time intervals
  const busyTimeIntervals: TimeInterval[] = busyEvents.map((event) => ({
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  }));

  // sort by start time
  busyTimeIntervals.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  // merge overlapping intervals
  // TODO: Extract and test this fn
  const mergedBusyTimeIntervals: TimeInterval[] = [];
  for (const interval of busyTimeIntervals) {
    if (mergedBusyTimeIntervals.length === 0) {
      mergedBusyTimeIntervals.push(interval);
    } else {
      const lastInterval =
        mergedBusyTimeIntervals[mergedBusyTimeIntervals.length - 1];
      if (
        areIntervalsOverlapping(
          { start: lastInterval.startsAt, end: lastInterval.endsAt },
          { start: interval.startsAt, end: interval.endsAt }
        )
      ) {
        // merge
        lastInterval.endsAt = new Date(Math.max(lastInterval.endsAt.getTime(), interval.endsAt.getTime()));
      } else {
        mergedBusyTimeIntervals.push(interval);
      }
    }
  }

  return mergedBusyTimeIntervals;

  // TODO: This fn requires heavy heavy testing. Do if time remains..
}
