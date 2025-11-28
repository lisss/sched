import { calendarEvents } from "./calendarEvents";
import { EmailMessage } from "./types/EmailMessage";
import { getTimeIntervalsUserIsBusy } from "./triggers/onNewEmailMessage/getTimeIntervalsUserIsBusy";
import { isEmailMessageContainingMeetingProposal, suggestMeetingSlotsForMeetingProposal, suggestMeetingSlotsForMeetingProposalDeterministic } from "./triggers/onNewEmailMessage/suggestMeetingSlots";

const USER_EMAIL = "matt.ffrench@fyxer.com";
const usersCalendarEvents = calendarEvents.map((event) => ({...event, userEmail: USER_EMAIL}));

export const getIntervalsIsBusy = () => {
  return getTimeIntervalsUserIsBusy(usersCalendarEvents, USER_EMAIL);
}

export const getSlots = async ({
  usersEmailMessage,
  useDeterministic = false,
}: {
  usersEmailMessage: EmailMessage;
  useDeterministic?: boolean;
}) => {
  const isMeetingProposal = await isEmailMessageContainingMeetingProposal(usersEmailMessage);

  if (!isMeetingProposal) {
    return [];
  }

  if (useDeterministic) {
    return await suggestMeetingSlotsForMeetingProposalDeterministic({
      emailMessage: usersEmailMessage,
      userCalendarEvents: usersCalendarEvents,
    });
  }
  const suggestedMeetingSlots = await suggestMeetingSlotsForMeetingProposal({
    emailMessage: usersEmailMessage,
    userCalendarEvents: usersCalendarEvents,
  });

  return suggestedMeetingSlots;
};

console.log("getSlots", getIntervalsIsBusy());

getSlots({
  useDeterministic: true,
  usersEmailMessage: {
    threadId: "AAMkAGI2TAAA=",
    isFirstInThread: true,
    providerEmailId: "AAMkAGI2TAAA=",
    to: [{ address: "matt.ffrench@fyxer.com", name: "Matt Ffrench" }],
    from: { address: "john@doe.com", name: "John Doe" },
    cc: [],
    bcc: [],
    content: "",
    fullBody: "Can you do our board meeting next week one afternoon?",
    isDraft: false,
    isSpam: false,
    messageId: "<>",
    forwardedContent: undefined,
    hasDoctypeHtml: false,
    subject: "Meeting Proposal",
    sentAt: new Date(),
    attachmentData: [],
    hasUnsubscribeLink: false,
    headers: [],
    folderIds: [],
    categoryIds: [],
    isRead: false,
    toEmailAddresses: ["matt.ffrench@fyxer.com"],
    ccEmailAddresses: [],
  }
}).then((slots) => {
  console.log("suggested slots", slots);
});


