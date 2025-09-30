import { CalendarEvent, TimeInterval } from "../../types/CalendarEvent";
import { EmailMessage } from "../../types/EmailMessage";
import { getTimeIntervalsUserIsBusy } from "./getTimeIntervalsUserIsBusy";
import { openAIClient } from "../../clients/openai";

import {
  // UTC => local
  toZonedTime,
  // local => UTC
  fromZonedTime,
} from "date-fns-tz";

const isEmailMessageContainingMeetingProposal = async (
  emailMessage: EmailMessage
): Promise<boolean> => {
  // unclear how a thread of emails is passed based on this type, assuming single email for now
  const emailContent = `${emailMessage.subject} ${emailMessage.fullBody}`;
  
  // LLM call to determine if email contains meeting proposal

  const prompt = `
  You are given the body of an email. Determine if it contains a proposal for a meeting (e.g., suggesting a time, asking to schedule, proposing to meet). 
  Answer only "YES" or "NO".

  Email content with subject:
  """
  ${emailContent}
  """
  `;

  const response = await openAIClient.chat.completions.create({
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
  // We don't have sender's calendar events, so only use the sender's email to detect times
  // and user's calendar events to detect free slots

  const userBusySlots = getTimeIntervalsUserIsBusy(
    userCalendarEvents,
    emailMessage.toEmailAddresses[0] // assuming first recipient is the user
  );

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

  const response = await openAIClient.chat.completions.create({
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
  // We don't have sender's calendar events, so only use the sender's email to detect times
  // and user's calendar events to detect free slots


  async function getProposedTimeSlots(): Promise<{ suggestions: TimeInterval[], noPreferences?: boolean}> {
    // LLM call to extract proposed times from email

    const prompt = `
    The sender has sent the following email:

    Subject: ${emailMessage.subject}
    Body: ${emailMessage.fullBody}

    The email was sent at ${emailMessage.sentAt.toISOString()}. Use the above information to process time preferences for the meeting.

    Return a JSON array of preferences for meeting times mentioned in the email. If no specific times are mentioned, return an empty array.

    Prefer one hour slots unless otherwise asked.
    For example, if the email says "Can we meet next Tuesday at 3pm or Thursday afternoon?", return:
    [
      { "startsAt": "<next Tuesday at 3pm in ISO 8601 format>", "endsAt": "<next Tuesday at 4pm in ISO 8601 format>" },
      { "startsAt": "<next Thursday at 1pm in ISO 8601 format>", "endsAt": "<next Thursday at 2pm in ISO 8601 format>" },
      { "startsAt": "<next Thursday at 2pm in ISO 8601 format>", "endsAt": "<next Thursday at 3pm in ISO 8601 format>" },
      { "startsAt": "<next Thursday at 3pm in ISO 8601 format>", "endsAt": "<next Thursday at 4pm in ISO 8601 format>" },
      { "startsAt": "<next Thursday at 4pm in ISO 8601 format>", "endsAt": "<next Thursday at 5pm in ISO 8601 format>" }
    ]

    For example, if the email says "Are you free today at 4 pm for a 1:1 for 45 mins?", return:
    [
      { "startsAt": "<today at 4pm in ISO 8601 format>", "endsAt": "<today at 4:45pm in ISO 8601 format>" }
    ]

    If no specific times are mentioned, return an empty array: [], but set the "noPreferences" flag to true.


    The response should be a JSON array of objects with the following structure:
    [{ "startsAt": "<start-time>", "endsAt": "<end-time>" }]
    `;

    const response = await openAIClient.chat.completions.create({
      model: "gpt-4o-mini", // use "gpt-4o-mini" or "gpt-4o" for efficiency
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 2000,
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
              },
              noPreferences: { type: "boolean" }
            },
            required: ["suggestions"],
            additionalProperties: false
          }
        }
      }
    });

    try {
      const suggestedSlots = JSON.parse(response.choices[0].message?.content || "[]");
      return Array.isArray(suggestedSlots.suggestions) ? suggestedSlots : { suggestions: []};
    } catch (error) {
      console.error("Failed to parse suggested meeting slots:", error);
      return { suggestions: []};
    }
  }

  // TODO: Move to a schema that doesn't need so many output tokens

  const proposedSlotsResponse = await getProposedTimeSlots();
  if (proposedSlotsResponse.noPreferences) {
    // If no specific times mentioned, suggest based on user's free slots during working hours
    // TODO: Implement this logic
    // For now, just return empty array
    return [];
    // return suggestBasedOnUserFreeSlots();
  }
  const proposedTimeSlots = proposedSlotsResponse.suggestions;
  const userBusySlots = getTimeIntervalsUserIsBusy(
    userCalendarEvents,
    emailMessage.toEmailAddresses[0] // assuming first recipient is the user
  );


  // Filter proposed slots against user's busy slots and working hours
  const filteredSlots = proposedTimeSlots.filter((slot) => {
    const slotStart = new Date(slot.startsAt);
    const slotEnd = new Date(slot.endsAt);

    // Check if within working hours (9am-5pm) and on a weekday
    if (
      slotStart.getHours() < 9 || slotEnd.getHours() > 18 ||
      slotStart.getDay() === 0 || slotStart.getDay() === 6
    ) {
      return false;
    }


    // Check for overlap with busy slots
    for (const busy of userBusySlots) {
      if (
        (slotStart < busy.endsAt && slotEnd > busy.startsAt)
      ) {
        return false; // Overlaps with a busy slot
      }
    }

    return true; // No overlaps, within working hours
  });

  // Limit to 5 suggestions
  return filteredSlots.slice(0, 5);
};

export {
  isEmailMessageContainingMeetingProposal,
  suggestMeetingSlotsForMeetingProposal,
  suggestMeetingSlotsForMeetingProposalDeterministic,
};