import { CalendarEvent, TimeInterval } from "../../types/CalendarEvent";
import { EmailMessage } from "../../types/EmailMessage";
import { getTimeIntervalsUserIsBusy } from "./getTimeIntervalsUserIsBusy";
import { openAIClient } from "../../clients/openai";
import { addWeeks } from "date-fns";

const WORKING_HOURS_START = 9;
const WORKING_HOURS_END = 17; // exclusive
const MAX_SUGGESTIONS = 5;
const FALLBACK_LOOKAHEAD_DAYS = 14;
const MEETING_KEYWORDS = [
  "meet",
  "meeting",
  "catch up",
  "catch-up",
  "catchup",
  "call",
  "chat",
  "board",
  "schedule",
  "availability",
  "session",
  "planning",
];

const MINUTES_IN_HOUR = 60;
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_WORKING_DAY_LOOKAHEAD = 5;

type MinuteWindow = {
  startMinutes: number;
  endMinutes: number;
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

type WindowToken = { window: MinuteWindow; index: number };
type DayMention = { day: Date; index: number };

const PERIOD_WINDOWS: Record<string, MinuteWindow> = {
  morning: { startMinutes: 9 * MINUTES_IN_HOUR, endMinutes: 12 * MINUTES_IN_HOUR },
  afternoon: { startMinutes: 13 * MINUTES_IN_HOUR, endMinutes: 17 * MINUTES_IN_HOUR },
  evening: { startMinutes: 17 * MINUTES_IN_HOUR, endMinutes: 19 * MINUTES_IN_HOUR },
};

const defaultWindow: MinuteWindow = {
  startMinutes: WORKING_HOURS_START * MINUTES_IN_HOUR,
  endMinutes: (WORKING_HOURS_START + 1) * MINUTES_IN_HOUR,
};

const minutesOfDay = (date: Date): number =>
  date.getHours() * MINUTES_IN_HOUR + date.getMinutes();

const overlapsBusySlot = (
  slot: TimeInterval,
  busySlots: TimeInterval[]
): boolean =>
  busySlots.some(
    (busy) => slot.startsAt < busy.endsAt && slot.endsAt > busy.startsAt
  );

const isWeekday = (date: Date): boolean => {
  const day = date.getDay();
  return day !== 0 && day !== 6;
};

const normalizeToDay = (date: Date): Date => {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
};

const upcomingWorkingDays = (
  startDate: Date,
  count: number
): Date[] =>
  Array.from({ length: FALLBACK_LOOKAHEAD_DAYS }, (_, offset) => {
    const day = new Date(startDate);
    day.setDate(day.getDate() + offset);
    return normalizeToDay(day);
  })
    .filter(isWeekday)
    .slice(0, count);

const minutesFromParts = (
  hourRaw: string,
  minuteRaw: string | undefined,
  meridiem: string | undefined,
  fallbackMeridiem?: string
): number | null => {
  const hour = Number(hourRaw);
  if (Number.isNaN(hour) || hour < 0 || hour > 24) {
    return null;
  }
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (Number.isNaN(minute) || minute < 0 || minute >= 60) {
    return null;
  }
  const suffix = meridiem ?? fallbackMeridiem;
  let normalizedHour = hour;
  if (suffix) {
    const lowerSuffix = suffix.toLowerCase();
    const isPM = lowerSuffix === "pm";
    const twelveHour = hour % 12;
    normalizedHour = twelveHour + (isPM ? 12 : 0);
  }
  return normalizedHour * MINUTES_IN_HOUR + minute;
};

const clampWindowToWorkingHours = (window: MinuteWindow): MinuteWindow => {
  const windowStart = Math.max(window.startMinutes, WORKING_HOURS_START * MINUTES_IN_HOUR);
  const windowEnd = Math.min(window.endMinutes, WORKING_HOURS_END * MINUTES_IN_HOUR);
  return { startMinutes: windowStart, endMinutes: windowEnd };
};

const extractRangeWindows = (content: string): WindowToken[] => {
  const rangeRegex =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
  const matches = [...content.matchAll(rangeRegex)];

  return matches
    .map((match) => {
      const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem] = match;
      
      const hasEndMeridiem = !!endMeridiem;
      const hasStartMeridiem = !!startMeridiem;
      
      const resolvedStart = minutesFromParts(
        startHour,
        startMinute,
        startMeridiem || (hasEndMeridiem ? endMeridiem : undefined),
        hasEndMeridiem ? endMeridiem : undefined
      );
      const resolvedEnd = minutesFromParts(
        endHour,
        endMinute,
        endMeridiem || (hasStartMeridiem ? startMeridiem : undefined),
        hasStartMeridiem ? startMeridiem : undefined
      );
      
      if (
        resolvedStart === null ||
        resolvedEnd === null ||
        resolvedEnd <= resolvedStart ||
        resolvedEnd - resolvedStart < 15
      ) {
        return null;
      }
      
      const clamped = clampWindowToWorkingHours({
        startMinutes: resolvedStart,
        endMinutes: resolvedEnd,
      });
      
      if (clamped.endMinutes <= clamped.startMinutes || clamped.endMinutes - clamped.startMinutes < 15) {
        return null;
      }
      
      return {
        window: clamped,
        index: match.index ?? 0,
      };
    })
    .filter((token): token is WindowToken => token !== null);
};

const extractDuration = (snippet: string): number => {
  const durationMatch = snippet.match(
    /for\s+(an?\s+)?(\d+)?\s?(minutes?|mins?|minute|hours?|hrs?|hr)/i
  );
  if (!durationMatch) {
    return DEFAULT_DURATION_MINUTES;
  }
  const [, , quantityRaw, unitRaw] = durationMatch;
  const quantity =
    quantityRaw === undefined ? 1 : Number(quantityRaw);
  if (Number.isNaN(quantity) || quantity <= 0) {
    return DEFAULT_DURATION_MINUTES;
  }
  const unit = unitRaw?.toLowerCase() ?? "";
  if (unit.startsWith("hour") || unit.startsWith("hr")) {
    return quantity * MINUTES_IN_HOUR;
  }
  return quantity;
};

const getRequestedDurationMinutes = (content: string): number => {
  const durationMatch = content.match(
    /for\s+(an?\s+)?(\d+)?\s?(minutes?|mins?|minute|hours?|hrs?|hr)/i
  );
  if (!durationMatch) {
    return DEFAULT_DURATION_MINUTES;
  }
  const [, , quantityRaw, unitRaw] = durationMatch;
  const quantity = quantityRaw ? Number(quantityRaw) : 1;
  if (Number.isNaN(quantity) || quantity <= 0) {
    return DEFAULT_DURATION_MINUTES;
  }
  const unit = unitRaw?.toLowerCase() ?? "";
  if (unit.startsWith("hour") || unit.startsWith("hr")) {
    return quantity * MINUTES_IN_HOUR;
  }
  return quantity;
};

const extractSingleTimeWindows = (content: string): WindowToken[] => {
  const singleTimeRegex = /(\d{1,2})(?::(\d{2}))?\s?(am|pm)/gi;
  const matches = [...content.matchAll(singleTimeRegex)];

  return matches
    .map((match) => {
      const { index = 0 } = match;
      const [, hour, minute, meridiem] = match;
      const startMinutes = minutesFromParts(hour, minute, meridiem);
      if (startMinutes === null) {
        return null;
      }
      const snippet = content.slice(index, index + 60);
      const durationMinutes = extractDuration(snippet);
      const clamped = clampWindowToWorkingHours({
        startMinutes,
        endMinutes: startMinutes + durationMinutes,
      });
      return { window: clamped, index };
    })
    .filter((token): token is WindowToken => token !== null);
};

const extractPeriodWindows = (content: string): WindowToken[] => {
  const tokens: WindowToken[] = [];
  Object.entries(PERIOD_WINDOWS).forEach(([keyword, window]) => {
    const regex = new RegExp(keyword, "gi");
    for (const match of content.matchAll(regex)) {
      tokens.push({
        window: clampWindowToWorkingHours({
          startMinutes: window.startMinutes,
          endMinutes: window.endMinutes,
        }),
        index: match.index ?? 0,
      });
    }
  });
  return tokens;
};

const getWindowTokens = (content: string): WindowToken[] => {
  const tokens = [
    ...extractRangeWindows(content),
    ...extractSingleTimeWindows(content),
    ...extractPeriodWindows(content),
  ];
  if (tokens.length > 0) {
    return tokens;
  }
  return [{ window: defaultWindow, index: -1 }];
};

const getNextWeekWorkdays = (now: Date): Date[] => {
  const daysUntilNextMonday = ((1 - now.getDay() + 7) % 7) || 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilNextMonday);
  const monday = normalizeToDay(nextMonday);

  return Array.from({ length: 5 }, (_, offset) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + offset);
    return day;
  });
};

const getDayMentions = (content: string, now: Date): DayMention[] => {
  const normalizedContent = content.toLowerCase();
  const dayRegex =
    /(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|today|tomorrow)/g;
  const matches = [...normalizedContent.matchAll(dayRegex)];

  const mentions = matches
    .map((match) => {
      const index = match.index ?? 0;
      const [, nextQualifier, dayToken] = match;
      if (dayToken === "today") {
        const today = normalizeToDay(now);
        return { day: today, index };
      }
      if (dayToken === "tomorrow") {
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        return { day: normalizeToDay(tomorrow), index };
      }

      const targetIndex = DAY_NAME_TO_INDEX[dayToken];
      if (targetIndex === undefined) {
        return null;
      }

      const currentDayIndex = now.getDay();
      let delta = (targetIndex - currentDayIndex + 7) % 7;
      if (delta === 0) {
        if (nextQualifier) {
          delta = 7;
        } else {
          const todayNormalized = normalizeToDay(now);
          const candidate = new Date(todayNormalized);
          candidate.setHours(17, 0, 0, 0);
          if (now >= candidate) {
            delta = 7;
          }
        }
      } else if (nextQualifier) {
        delta += 7;
      }
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + delta);
      return { day: normalizeToDay(candidate), index };
    })
    .filter((mention): mention is DayMention => mention !== null)
    .filter((mention) => isWeekday(mention.day))
    .filter((mention) => mention.day <= addWeeks(now, 2));

  const nextWeekIndex = normalizedContent.indexOf("next week");
  if (nextWeekIndex !== -1) {
    getNextWeekWorkdays(now).forEach((day) => {
      mentions.push({ day, index: nextWeekIndex });
    });
  }

  const dedup = new Map<string, DayMention>();
  mentions.forEach((mention) => {
    const key = mention.day.toDateString();
    if (!dedup.has(key) || dedup.get(key)!.index > mention.index) {
      dedup.set(key, mention);
    }
  });

  return Array.from(dedup.values()).sort((a, b) => a.index - b.index);
};

const createSlotsFromWindow = (
  day: Date,
  window: MinuteWindow,
  durationMinutes: number
): TimeInterval[] => {
  const slots: TimeInterval[] = [];
  const normalizedDay = new Date(day);
  normalizedDay.setHours(0, 0, 0, 0);

  const startHours = Math.floor(window.startMinutes / MINUTES_IN_HOUR);
  const startMins = window.startMinutes % MINUTES_IN_HOUR;
  const endHours = Math.floor(window.endMinutes / MINUTES_IN_HOUR);
  const endMins = window.endMinutes % MINUTES_IN_HOUR;

  for (
    let offset = window.startMinutes;
    offset + durationMinutes <= window.endMinutes;
    offset += durationMinutes
  ) {
    const offsetHours = Math.floor(offset / MINUTES_IN_HOUR);
    const offsetMins = offset % MINUTES_IN_HOUR;
    
    const slotStart = new Date(normalizedDay);
    slotStart.setHours(offsetHours, offsetMins, 0, 0);
    
    const durationHours = Math.floor(durationMinutes / MINUTES_IN_HOUR);
    const durationMins = durationMinutes % MINUTES_IN_HOUR;
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(
      slotStart.getHours() + durationHours,
      slotStart.getMinutes() + durationMins,
      0,
      0
    );
    
    slots.push({ startsAt: slotStart, endsAt: slotEnd });
  }

  if (slots.length === 0) {
    const slotStart = new Date(normalizedDay);
    slotStart.setHours(startHours, startMins, 0, 0);
    const slotEnd = new Date(normalizedDay);
    slotEnd.setHours(endHours, endMins, 0, 0);
    if (slotEnd > slotStart) {
      slots.push({ startsAt: slotStart, endsAt: slotEnd });
    }
  }

  return slots;
};

const buildDayWindowPairs = (
  dayMentions: DayMention[],
  windowTokens: WindowToken[],
  content: string
): { day: Date; window: MinuteWindow }[] => {
  if (dayMentions.length === 0 || windowTokens.length === 0) {
    return [];
  }

  const orRegex = /\s+or\s+/gi;
  const orMatches = [...content.matchAll(orRegex)];
  const orPositions = orMatches.map(m => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length
  }));

  return dayMentions.flatMap((mention, index) => {
    const nextDayIndex = dayMentions[index + 1]?.index ?? content.length;
    
    const relevantOr = orPositions.find(or => 
      or.start > mention.index && or.end < nextDayIndex
    );
    
    const boundary = relevantOr ? relevantOr.end : nextDayIndex;
    const searchStart = Math.max(0, mention.index - 200);
    const windowsInSpan = windowTokens.filter(
      (token) => token.index >= searchStart && token.index < boundary
    );
    
    if (windowsInSpan.length === 0) {
      const fallbackWindows = windowTokens.filter(
        (token) => token.index >= mention.index && token.index < nextDayIndex
      );
      if (fallbackWindows.length > 0) {
        const sorted = fallbackWindows.sort((a, b) => {
          const aSize = a.window.endMinutes - a.window.startMinutes;
          const bSize = b.window.endMinutes - b.window.startMinutes;
          return aSize - bSize;
        });
        return [{ day: mention.day, window: sorted[0].window }];
      }
      const allWindows = windowTokens.filter(
        (token) => token.index > mention.index
      );
      if (allWindows.length > 0) {
        const sorted = allWindows.sort((a, b) => {
          const aDist = Math.abs(a.index - mention.index);
          const bDist = Math.abs(b.index - mention.index);
          return aDist - bDist;
        });
        return [{ day: mention.day, window: sorted[0].window }];
      }
      if (windowTokens.length > 0) {
        const sorted = windowTokens.sort((a, b) => {
          const aDist = Math.abs((a.index || 0) - mention.index);
          const bDist = Math.abs((b.index || 0) - mention.index);
          return aDist - bDist;
        });
        return [{ day: mention.day, window: sorted[0].window }];
      }
      return [];
    }
    
    const sortedWindows = windowsInSpan.sort((a, b) => {
      const aSize = a.window.endMinutes - a.window.startMinutes;
      const bSize = b.window.endMinutes - b.window.startMinutes;
      const sizeDiff = aSize - bSize;
      if (Math.abs(sizeDiff) > 60) {
        return sizeDiff;
      }
      const aDist = Math.abs(a.index - mention.index);
      const bDist = Math.abs(b.index - mention.index);
      return aDist - bDist;
    });
    
    const bestWindow = sortedWindows[0];
    const specificWindows = sortedWindows.filter(w => {
      const size = w.window.endMinutes - w.window.startMinutes;
      return size <= 4 * MINUTES_IN_HOUR;
    });
    
    if (specificWindows.length > 0) {
      return specificWindows.map(w => ({
        day: mention.day,
        window: w.window
      }));
    }
    
    return [{ 
      day: mention.day, 
      window: bestWindow.window 
    }];
  });
};

const filterValidSlots = (
  slots: TimeInterval[],
  busySlots: TimeInterval[],
  now: Date
): TimeInterval[] =>
  slots
    .filter((slot) => slot.startsAt >= now)
    .filter((slot) => slot.endsAt > slot.startsAt)
    .filter((slot) => isWeekday(slot.startsAt))
    .filter((slot) => {
      const startMinutes = minutesOfDay(slot.startsAt);
      const endMinutes = minutesOfDay(slot.endsAt);
      return (
        startMinutes >= WORKING_HOURS_START * MINUTES_IN_HOUR &&
        endMinutes <= WORKING_HOURS_END * MINUTES_IN_HOUR &&
        endMinutes - startMinutes >= 15
      );
    })
    .filter((slot) => slot.endsAt <= addWeeks(now, 2))
    .filter((slot) => !overlapsBusySlot(slot, busySlots));

const containsMeetingKeywords = (content: string): boolean => {
  const lower = content.toLowerCase();
  return MEETING_KEYWORDS.some((keyword) => lower.includes(keyword));
};

const generateFallbackSlots = (userBusySlots: TimeInterval[]): TimeInterval[] => {
  const now = new Date();
  const candidateDays = upcomingWorkingDays(now, FALLBACK_LOOKAHEAD_DAYS);

  const candidateSlots = candidateDays.flatMap((day) =>
    Array.from(
      { length: WORKING_HOURS_END - WORKING_HOURS_START },
      (_, index) => {
        const slotStart = new Date(day);
        slotStart.setHours(WORKING_HOURS_START + index, 0, 0, 0);
        const slotEnd = new Date(slotStart);
        slotEnd.setHours(slotStart.getHours() + 1, slotStart.getMinutes(), 0, 0);
        return { startsAt: slotStart, endsAt: slotEnd };
      }
    )
  );

  return candidateSlots
    .filter((slot) => slot.startsAt > now)
    .filter((slot) => !overlapsBusySlot(slot, userBusySlots))
    .slice(0, MAX_SUGGESTIONS);
};

const isEmailMessageContainingMeetingProposal = async (
  emailMessage: EmailMessage
): Promise<boolean> => {
  // unclear how a thread of emails is passed based on this type, assuming single email for now
  const emailContent = `${emailMessage.subject} ${emailMessage.fullBody}`;

  if (!openAIClient) {
    return containsMeetingKeywords(emailContent);
  }
  const llmClient = openAIClient;
  if (!llmClient) {
    throw new Error("OpenAI client unavailable");
  }

  const prompt = `
  You are given the body of an email. Determine if it contains a proposal for a meeting (e.g., suggesting a time, asking to schedule, proposing to meet). 
  Answer only "YES" or "NO".

  Email content with subject:
  """
  ${emailContent}
  """
  `;

  const response = await llmClient.chat.completions.create({
    model: "gpt-4o-mini", // use "gpt-4o-mini" or "gpt-4o" for efficiency
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 5
  });

  const result = response.choices[0].message?.content?.trim().toUpperCase();
  return result === "YES";

};

const suggestMeetingSlotsForMeetingProposal = async ({
  emailMessage,
  userCalendarEvents,
}: {
  emailMessage: EmailMessage;
  userCalendarEvents: CalendarEvent[];
}): Promise<TimeInterval[]> => {
  const userBusySlots = getTimeIntervalsUserIsBusy(
    userCalendarEvents,
    emailMessage.toEmailAddresses[0] // assuming first recipient is the user
  );

  if (!openAIClient) {
    return suggestMeetingSlotsForMeetingProposalDeterministic({
      emailMessage,
      userCalendarEvents,
    });
  }
  const llmClient = openAIClient;
  // TODO: Consider using LLM only to parse email for specific times mentioned, e.g., "next Tuesday at 3pm" or "Thursday afternoon"
  // and then use that to filter the busy slots, rather than asking LLM to suggest times entirely. For today though, this is less complicated and faster; although more prone to errors.


  const prompt = `
  The sender has sent the following email:

  Subject: ${emailMessage.subject}
  Body: ${emailMessage.fullBody}

  The email was sent at ${emailMessage.sentAt.toISOString()}. Use the above information as time preferences for the meeting.

  The user's existing meeting slots are as follows: Do not schedule during this time.
  ${JSON.stringify(userBusySlots)}


  Do not schedule outside of working hours (9am-5pm) or on weekends. Always prefer days with existing meetings first.
  Choose time slots that begin on the hour if possible. For example, 9:00 to 10:00 is better than 9:15 to 10:15. Choose one hour slots unless otherwise asked.

  Based on the email content and the user's busy slots, suggest five possible time intervals for a meeting.
  Make sure the suggested slots do not overlap with the user's busy slots and are within the next two weeks, unless otherwise requested.
  The response should be a JSON array of objects with the following structure:
  [{ "startsAt": "<start-time>", "endsAt": "<end-time>" }]
  `;

  const response = await llmClient.chat.completions.create({
    model: "gpt-4o-mini", // use "gpt-4o-mini" or "gpt-4o" for efficiency
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 800,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_time_suggestions",
        schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  startsAt: { 
                    type: "string",
                    description: "Start time in ISO 8601 format"
                  },
                  endsAt: { 
                    type: "string",
                    description: "End time in ISO 8601 format"
                  }
                },
                required: ["startsAt", "endsAt"],
                additionalProperties: false
              }
            }
          },
          required: ["suggestions"],
          additionalProperties: false
        }
      }
    }
  });

  try {
    const suggestedSlots = JSON.parse(response.choices[0].message?.content || "[]");
    return Array.isArray(suggestedSlots.suggestions) ? suggestedSlots.suggestions : [];
  } catch (error) {
    console.error("Failed to parse suggested meeting slots:", error);
    return [];
  }
};


const suggestMeetingSlotsForMeetingProposalDeterministic = async ({
  emailMessage,
  userCalendarEvents,
}: {
  emailMessage: EmailMessage;
  userCalendarEvents: CalendarEvent[];
}): Promise<TimeInterval[]> => {
  const userBusySlots = getTimeIntervalsUserIsBusy(
    userCalendarEvents,
    emailMessage.toEmailAddresses[0]
  );
  const now = new Date();
  const content = `${emailMessage.subject ?? ""} ${emailMessage.fullBody ?? ""}`.toLowerCase();

  const dayMentions = getDayMentions(content, now);
  const windowTokens = getWindowTokens(content);
  const requestedDurationMinutes = getRequestedDurationMinutes(content);
  const isTodayMentioned = content.includes("today");
  const todayDate = normalizeToDay(now);

  let dayWindowPairs: { day: Date; window: MinuteWindow }[] = [];
  
  if (dayMentions.length > 0 && windowTokens.length > 0) {
    dayWindowPairs = buildDayWindowPairs(dayMentions, windowTokens, content);
    
    if (dayWindowPairs.length === 0) {
      dayWindowPairs = dayMentions.flatMap((mention) =>
        windowTokens.map((token) => ({ day: mention.day, window: token.window }))
      );
    }
  } else if (dayMentions.length > 0 && windowTokens.length === 0) {
    dayWindowPairs = dayMentions.map((mention) => {
      const isToday = mention.day.toDateString() === todayDate.toDateString();
      if (isToday && isTodayMentioned) {
        const currentMinutes = minutesOfDay(now);
        const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
        const window: MinuteWindow = {
          startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
          endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
        };
        return { day: mention.day, window };
      }
      return { day: mention.day, window: defaultWindow };
    });
  } else if (dayMentions.length === 0 && windowTokens.length > 0) {
    dayWindowPairs = upcomingWorkingDays(now, DEFAULT_WORKING_DAY_LOOKAHEAD).flatMap((day) =>
      windowTokens.map((token) => ({ day, window: token.window }))
    );
  }
  
  if (dayWindowPairs.length === 0 && dayMentions.length > 0) {
    if (windowTokens.length > 0) {
      dayWindowPairs = dayMentions.flatMap((mention) =>
        windowTokens.map((token) => ({ day: mention.day, window: token.window }))
      );
    } else {
      dayWindowPairs = dayMentions.map((mention) => {
        const isToday = mention.day.toDateString() === todayDate.toDateString();
        if (isToday && isTodayMentioned) {
          const currentMinutes = minutesOfDay(now);
          const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
          const window: MinuteWindow = {
            startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
            endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
          };
          return { day: mention.day, window };
        }
        return { day: mention.day, window: defaultWindow };
      });
    }
  }
  
  if (isTodayMentioned && dayWindowPairs.length === 0 && dayMentions.length > 0 && windowTokens.length > 0) {
    const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
    if (todayMention) {
      dayWindowPairs = windowTokens.map((token) => ({ day: todayMention.day, window: token.window }));
    }
  }

  if (isTodayMentioned && dayWindowPairs.length === 0) {
    if (dayMentions.length > 0 && windowTokens.length > 0) {
      const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
      if (todayMention) {
        dayWindowPairs = windowTokens.map((token) => ({ day: todayMention.day, window: token.window }));
      } else if (dayMentions.length > 0) {
        dayWindowPairs = dayMentions.flatMap((mention) =>
          windowTokens.map((token) => ({ day: mention.day, window: token.window }))
        );
      }
    } else if (dayMentions.length > 0) {
      const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
      if (todayMention) {
        const currentMinutes = minutesOfDay(now);
        const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
        const window: MinuteWindow = {
          startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
          endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
        };
        dayWindowPairs = [{ day: todayMention.day, window }];
      }
    }
  }

  const candidateSlots = dayWindowPairs.flatMap(({ day, window }) => {
    const isToday = day.toDateString() === todayDate.toDateString();
    
    if (isToday && isTodayMentioned) {
      const todaySlots = createSlotsFromWindow(day, window, requestedDurationMinutes);
      const validTodaySlots = todaySlots.filter(slot => slot.startsAt >= now);
      
      if (validTodaySlots.length > 0) {
        return validTodaySlots;
      }
      
      const currentMinutes = minutesOfDay(now);
      const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
      if (nextHourStart < WORKING_HOURS_END * MINUTES_IN_HOUR) {
        const restOfTodayWindow: MinuteWindow = {
          startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
          endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
        };
        const restOfTodaySlots = createSlotsFromWindow(day, restOfTodayWindow, requestedDurationMinutes);
        const validRestOfToday = restOfTodaySlots.filter(slot => slot.startsAt >= now);
        if (validRestOfToday.length > 0) {
          return validRestOfToday;
        }
      }
      
      for (let i = 1; i <= 14; i++) {
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + i);
        if (isWeekday(nextDay)) {
          const nextDaySlots = createSlotsFromWindow(normalizeToDay(nextDay), window, requestedDurationMinutes);
          const validNextSlots = nextDaySlots.filter(slot => slot.startsAt >= now);
          if (validNextSlots.length > 0) {
            return validNextSlots;
          }
        }
      }
      
      return todaySlots;
    }
    
    return createSlotsFromWindow(day, window, requestedDurationMinutes);
  });

  const validSlots = filterValidSlots(candidateSlots, userBusySlots, now);

  if (validSlots.length > 0) {
    return validSlots.slice(0, MAX_SUGGESTIONS);
  }

  if (isTodayMentioned) {
    const todaySlotsOnly = candidateSlots.filter(slot => {
      const slotDay = normalizeToDay(slot.startsAt);
      return slotDay.toDateString() === todayDate.toDateString() && slot.startsAt >= now;
    });
    
    if (todaySlotsOnly.length > 0) {
      const todayValid = filterValidSlots(todaySlotsOnly, userBusySlots, now);
      if (todayValid.length > 0) {
        return todayValid.slice(0, MAX_SUGGESTIONS);
      }
      
      const todayRelaxed = todaySlotsOnly
        .filter((slot) => slot.endsAt > slot.startsAt)
        .filter((slot) => isWeekday(slot.startsAt))
        .filter((slot) => slot.endsAt <= addWeeks(now, 2))
        .slice(0, MAX_SUGGESTIONS);
      
      if (todayRelaxed.length > 0) {
        return todayRelaxed;
      }
    }
    
    if (candidateSlots.length === 0 && dayWindowPairs.length === 0) {
      const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
      if (todayMention) {
        const currentMinutes = minutesOfDay(now);
        const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
        const window: MinuteWindow = {
          startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
          endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
        };
        const forceTodaySlots = createSlotsFromWindow(todayMention.day, window, requestedDurationMinutes);
        const forceTodayValid = filterValidSlots(forceTodaySlots, userBusySlots, now);
        if (forceTodayValid.length > 0) {
          return forceTodayValid.slice(0, MAX_SUGGESTIONS);
        }
      }
    }
  }

  if (isTodayMentioned && validSlots.length === 0) {
    const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
    if (todayMention) {
      let emergencyPairs: { day: Date; window: MinuteWindow }[] = [];
      
      if (windowTokens.length > 0) {
        emergencyPairs = windowTokens.map((token) => ({ day: todayMention.day, window: token.window }));
      } else {
        const currentMinutes = minutesOfDay(now);
        const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
        const window: MinuteWindow = {
          startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
          endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
        };
        emergencyPairs = [{ day: todayMention.day, window }];
      }
      
      const emergencySlots = emergencyPairs.flatMap(({ day, window }) => {
        const slots = createSlotsFromWindow(day, window, requestedDurationMinutes);
        const valid = slots.filter(slot => slot.startsAt >= now);
        if (valid.length > 0) {
          return valid;
        }
        for (let i = 1; i <= 14; i++) {
          const nextDay = new Date(day);
          nextDay.setDate(day.getDate() + i);
          if (isWeekday(nextDay)) {
            const nextSlots = createSlotsFromWindow(normalizeToDay(nextDay), window, requestedDurationMinutes);
            const validNext = nextSlots.filter(slot => slot.startsAt >= now);
            if (validNext.length > 0) {
              return validNext;
            }
          }
        }
        return slots;
      });
      
      const emergencyValid = filterValidSlots(emergencySlots, userBusySlots, now);
      if (emergencyValid.length > 0) {
        return emergencyValid.slice(0, MAX_SUGGESTIONS);
      }
      
      const emergencyRelaxed = emergencySlots
        .filter((slot) => slot.startsAt >= now)
        .filter((slot) => slot.endsAt > slot.startsAt)
        .filter((slot) => isWeekday(slot.startsAt))
        .filter((slot) => slot.endsAt <= addWeeks(now, 2))
        .slice(0, MAX_SUGGESTIONS);
      
      if (emergencyRelaxed.length > 0) {
        return emergencyRelaxed;
      }
    }
  }

  if (dayWindowPairs.length > 0) {
    const relaxedSlots = candidateSlots
      .filter((slot) => slot.startsAt >= now)
      .filter((slot) => slot.endsAt > slot.startsAt)
      .filter((slot) => isWeekday(slot.startsAt))
      .filter((slot) => slot.endsAt <= addWeeks(now, 2))
      .slice(0, MAX_SUGGESTIONS);
    
    if (relaxedSlots.length > 0) {
      return relaxedSlots;
    }
  }

  if (isTodayMentioned) {
    const fallbackSlots = generateFallbackSlots(userBusySlots);
    if (fallbackSlots.length > 0) {
      return fallbackSlots;
    }
    
    const todayMention = dayMentions.find(m => m.day.toDateString() === todayDate.toDateString());
    if (todayMention) {
      const currentMinutes = minutesOfDay(now);
      const nextHourStart = Math.ceil(currentMinutes / MINUTES_IN_HOUR) * MINUTES_IN_HOUR;
      const window: MinuteWindow = {
        startMinutes: Math.max(nextHourStart, WORKING_HOURS_START * MINUTES_IN_HOUR),
        endMinutes: WORKING_HOURS_END * MINUTES_IN_HOUR,
      };
      
      for (let i = 0; i <= 14; i++) {
        const targetDay = new Date(todayMention.day);
        targetDay.setDate(todayMention.day.getDate() + i);
        if (isWeekday(targetDay)) {
          const slots = createSlotsFromWindow(normalizeToDay(targetDay), window, requestedDurationMinutes);
          const valid = slots.filter(slot => slot.startsAt >= now);
          if (valid.length > 0) {
            return valid.slice(0, MAX_SUGGESTIONS);
          }
        }
      }
    }
  }

  const fallbackSlots = generateFallbackSlots(userBusySlots);
  if (fallbackSlots.length > 0) {
    return fallbackSlots;
  }

  return [];
};

export {
  isEmailMessageContainingMeetingProposal,
  suggestMeetingSlotsForMeetingProposal,
  suggestMeetingSlotsForMeetingProposalDeterministic,
};