import { getTimeIntervalsUserIsBusy } from "./getTimeIntervalsUserIsBusy";
import { CalendarEvent } from "../../types/CalendarEvent";

describe("getTimeIntervalsUserIsBusy", () => {
  const userEmail = "user@example.com";

  it("should return an empty array when there are no events", () => {
    const events: CalendarEvent[] = [];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([]);
  });

  it("should filter out events outside the next two weeks", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30), // 30 days ago
        endsAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 29), // 29 days ago
        isAllDay: false,
        title: "Past Event",
        isRecurring: false,
      },
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 15), // 15 days from now
        endsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 16), // 16 days from now
        isAllDay: false,
        title: "Future Event",
        isRecurring: false,
      },
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 150), // 150 days from now
        endsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 160), // 160 days from now
        isAllDay: false,
        title: "Future Event",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([]);
  });

  it("should mark all-day events with 'OOO' in the title as busy", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24),
        isAllDay: true,
        title: "OOO",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([
      { startsAt: now, endsAt: new Date(now.getTime() + 1000 * 60 * 60 * 24) },
    ]);
  });

  it("should merge overlapping intervals", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60), // 1 hour
        isAllDay: false,
        title: "Event 1",
        isRecurring: false,
      },
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [],
        startsAt: new Date(now.getTime() + 1000 * 60 * 30), // 30 minutes later
        endsAt: new Date(now.getTime() + 1000 * 60 * 90), // 1.5 hours
        isAllDay: false,
        title: "Event 2",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([
      { startsAt: now, endsAt: new Date(now.getTime() + 1000 * 60 * 90) },
    ]);
  });

  it("should exclude events where the user has declined the invite", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: "organiser@example.com", name: "Organiser" },
        invitees: [
          {
            emailAddress: userEmail,
            name: "User",
            attendanceDecision: "DECLINED",
          },
        ],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60),
        isAllDay: false,
        title: "Declined Event",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([]);
  });

  it("should include events where the user has accepted the invite", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: "organiser@example.com", name: "Organiser" },
        invitees: [
          {
            emailAddress: userEmail,
            name: "User",
            attendanceDecision: "ACCEPTED",
          },
        ],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60),
        isAllDay: false,
        title: "Accepted Event",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([
      { startsAt: now, endsAt: new Date(now.getTime() + 1000 * 60 * 60) },
    ]);
  });

  it("should include events where the user has tentatively accepted the invite", () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: "organiser@example.com", name: "Organiser" },
        invitees: [
          {
            emailAddress: userEmail,
            name: "User",
            attendanceDecision: "TENTATIVE",
          },
        ],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60),
        isAllDay: false,
        title: "Tentative Event",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([
      { startsAt: now, endsAt: new Date(now.getTime() + 1000 * 60 * 60) },
    ]);
  });

  it('should not include events where user is organiser and all attendees have declined', () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [
          {
            emailAddress: "a@b.com",
            name: "A B",
            attendanceDecision: "DECLINED",
          },
          {
            emailAddress: "b@b.com",
            name: "B B",
            attendanceDecision: "DECLINED",
          },
        ],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60),
        isAllDay: false,
        title: "Organiser Event - All Declined",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([]);
  });

  it('should include events where user is organiser and at least one attendee has not declined', () => {
    const now = new Date();
    const events: CalendarEvent[] = [
      {
        organiser: { emailAddress: userEmail, name: "User" },
        invitees: [
          {
            emailAddress: "a@b.com",
            name: "A B",
            attendanceDecision: "DECLINED",
          },
          {
            emailAddress: "b@b.com",
            name: "B B",
            attendanceDecision: "ACCEPTED",
          },
        ],
        startsAt: now,
        endsAt: new Date(now.getTime() + 1000 * 60 * 60),
        isAllDay: false,
        title: "Organiser Event - One Accepted",
        isRecurring: false,
      },
    ];
    const result = getTimeIntervalsUserIsBusy(events, userEmail);
    expect(result).toEqual([
      { startsAt: now, endsAt: new Date(now.getTime() + 1000 * 60 * 60) },
    ]);
  });
});