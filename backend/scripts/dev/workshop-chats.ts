// Real Core turns are recorded once against the Workshop Year fixture. The
// checked-in transcript is reused by the ordinary seed without provider calls.
export const workshopChatPlans = [
  {
    slug: 'the-idea', title: 'Why This Place',
    messages: [
      'What first made me want to open the Canal Street workshop?',
      'In general, what makes a neighborhood workshop feel welcoming rather than intimidating?',
      'How might I explain the idea to someone who has never visited a makerspace?',
      'What did my first notes assume about the opening hours and equipment?',
      'Which part of the original ambition is worth keeping even if we start smaller?',
      'Help me put the purpose of the first phase into one warm paragraph.',
    ],
  },
  {
    slug: 'listening', title: 'Listening to Neighbors',
    messages: [
      'What did Iman say people actually need from a repair evening?',
      'What tends to make a beginner nervous about joining a hands-on group?',
      'What did the neighborhood survey say people want to learn and when they can come?',
      'How can we invite beginners without promising to fix every object?',
      'Which accessibility needs came up in our notes?',
      'What would be a good open-ended question to ask people at the trial?',
    ],
  },
  {
    slug: 'the-room', title: 'Making the Room Work',
    messages: [
      'What did we notice on our first visit to the Canal Street room?',
      'What generally helps a small shared space stay flexible?',
      'Why did we choose Layout B instead of the eight-bench plan?',
      'How could we explain that choice without sounding defensive?',
      'What did the electrician find, and how did that affect the layout?',
      'What practical detail should we check again before opening?',
    ],
  },
  {
    slug: 'the-budget', title: 'Starting Smaller',
    messages: [
      'Between my initial-budget.md and revised-budget.md, which is the current working budget?',
      'Why is it wise to leave room for unexpected costs in a small project?',
      'According to revised-budget.md, what are the up-front fit-out cost and monthly rent? Are they separate?',
      'What purchases did we decide to defer?',
      'How would you talk about these trade-offs to someone excited by the first plan?',
      'What should we check after the trial before spending more?',
    ],
  },
  {
    slug: 'the-opening', title: 'Getting Ready to Open',
    messages: [
      'Is the public workshop opening still planned for 2 April?',
      'In general, what makes a community invitation feel personal?',
      'When are the private trial and the public opening now?',
      'Could you write a short, friendly invitation using the confirmed details?',
      'What should someone new know before coming along?',
      'Does my final poster copy agree with that invitation?',
    ],
  },
  {
    slug: 'after-the-trial', title: 'After the First Trial',
    messages: [
      'What happened at our bring-one-thing trial?',
      'What could I ask visitors next time to learn what worked for them?',
      'What did we learn about the benches, labels, and sink area?',
      'What do the stored captions for community-table and community-repair say about people working together at the workshop?',
      'How should I think about success over the next three months?',
      'What does the six-month vision say we should focus on next?',
    ],
  },
] as const;
