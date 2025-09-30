import { CalendarEvent, TimeInterval } from "../../types/CalendarEvent";
import { EmailMessage } from "../../types/EmailMessage";
import OpenAI from "openai";



const isEmailMessageContainingMeetingProposal = async (
  emailMessage: EmailMessage
): Promise<boolean> => {
  // unclear how a thread of emails is passed based on this type, assuming single email for now
  const emailContent = `${emailMessage.subject} ${emailMessage.fullBody}`;
  
  // LLM call to determine if email contains meeting proposal
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
  });

  const prompt = `
  You are given the body of an email. Determine if it contains a proposal for a meeting (e.g., suggesting a time, asking to schedule, proposing to meet). 
  Answer only "YES" or "NO".

  Email content with subject:
  """
  ${emailContent}
  """
  `;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini", // use "gpt-4o-mini" or "gpt-4o" for efficiency
    messages: [{ role: "user", content: prompt }],
    max_completion_tokens: 5
  });

  const result = response.choices[0].message?.content?.trim().toUpperCase();
  return result === "YES";

};

const suggestMeetingSlotsForMeetingProposal = ({
  emailMessage,
  userCalendarEvents,
}: {
  emailMessage: EmailMessage;
  userCalendarEvents: CalendarEvent[];
}): TimeInterval[] => {
  return [
    // returning of available meeting slots
  ];
};