import { calendarEvents } from "./calendarEvents";
import { EmailMessage } from "./types/EmailMessage";
import { getTimeIntervalsUserIsBusy } from "./triggers/onNewEmailMessage/getTimeIntervalsUserIsBusy";
import { isEmailMessageContainingMeetingProposal, suggestMeetingSlotsForMeetingProposal, suggestMeetingSlotsForMeetingProposalDeterministic } from "./triggers/onNewEmailMessage/suggestMeetingSlots";

// consts
const USER_EMAIL = "matt.ffrench@fyxer.com";
const usersCalendarEvents = calendarEvents.map((event) => ({...event, userEmail: USER_EMAIL}));

// Q-PRE
export const mainPre = () => {
  return getTimeIntervalsUserIsBusy(usersCalendarEvents, USER_EMAIL);
}

// Q-MAIN-1
export const main1 = async ({
  usersEmailMessage,
  useDeterministic = false,
}: {
  usersEmailMessage: EmailMessage;
  useDeterministic?: boolean;
}) => {
  // See functions in ./triggers/onNewEmailMessage/suggestMeetingSlots.ts

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

// testing, assuming this is how they'll be called
console.log("mainPre", mainPre());

main1({
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


