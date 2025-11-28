import { parseISO, differenceInMilliseconds, addMilliseconds } from "date-fns";
import { AttendanceDecision } from "./types/CalendarEvent";

const RAW_STARTS_AT = parseISO("2024-01-31T00:00:00Z");
const startOfUTCDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const convertDateToFromNow = (date: Date) =>
  addMilliseconds(startOfUTCDay(new Date()), differenceInMilliseconds(date, RAW_STARTS_AT));

export const calendarEvents = [
  {
    title: "Matt OOO",
    startsAt: "2024-02-02T00:00:00Z",
    endsAt: "2024-02-14T00:00:00Z",
    isAllDay: true,
    isRecurring: false,
    organiser: {
      emailAddress: "matt.ffrench@fyxer.com",
      name: "Matt Ffrench",
    },
    invitees: [],
  },
  {
    title: "Standup",
    startsAt: "2024-01-31T09:00:00Z",
    endsAt: "2024-01-31T09:15:00Z",
    isAllDay: false,
    isRecurring: true,
    organiser: {
      emailAddress: "matt.ffrench@fyxer.com",
      name: "Matt Ffrench",
    },
    invitees: [
      {
        emailAddress: "adrian.chen@fyxer.com",
        name: "Adrian Chen",
        attendanceDecision: "ACCEPTED",
      },
      {
        emailAddress: "susan.khan@fyxer.com",
        name: "Susan Khan",
        attendanceDecision: "ACCEPTED",
      },
      {
        emailAddress: "ellie.rice@fyxer.com",
        name: "Ellie Rice",
        attendanceDecision: "ACCEPTED",
      },
    ],
  },
  {
    title: "Client call",
    startsAt: "2024-01-31T14:00:00Z",
    endsAt: "2024-01-31T15:00:00Z",
    isAllDay: false,
    isRecurring: false,
    organiser: {
      emailAddress: "archie@fyxer.com",
      name: "Archie",
    },
    invitees: [
      {
        emailAddress: "matt.ffrench@fyxer.com",
        name: "Matt Ffrench",
        attendanceDecision: "TENTATIVE",
      },
      {
        emailAddress: "samual@time.vc",
        name: "Samual",
        attendanceDecision: "TENTATIVE",
      },
      {
        emailAddress: "jason.dennis@dealcapital",
        name: "Jason Dennis",
        attendanceDecision: "ACCEPTED",
      },
    ],
  },
  {
    title: "Refinement Session",
    startsAt: "2024-01-31T11:30:00Z",
    endsAt: "2024-01-31T12:00:00Z",
    isAllDay: false,
    isRecurring: false,
    organiser: {
      emailAddress: "ellie.rice@fyxer.com",
      name: "Ellie Rice",
    },
    invitees: [
      {
        emailAddress: "matt.ffrench@fyxer.com",
        name: "Matt Ffrench",
        attendanceDecision: "ACCEPTED",
      },
      {
        emailAddress: "adrian.chen@fyxer.com",
        name: "Adrian Chen",
        attendanceDecision: "DECLINED",
      },
      {
        emailAddress: "susan.khan@fyxer.com",
        name: "Susan Khan",
        attendanceDecision: "DECLINED",
      },
      {
        emailAddress: "ellie.rice@fyxer.com",
        name: "Ellie Rice",
        attendanceDecision: "ACCEPTED",
      },
    ],
  },
]
.map((event) => ({
  ...event,
  startsAt: convertDateToFromNow(parseISO(event.startsAt)),
  endsAt: convertDateToFromNow(parseISO(event.endsAt)),
  invitees: event.invitees.map((invitee) => ({
    ...invitee,
    attendanceDecision: invitee.attendanceDecision as AttendanceDecision,
  })),
}));
