/** Actual provider answers are checked against these independent fixture facts. */
export type LiveScenario = { area: string; question: string; facts: RegExp[]; contradictions?: RegExp[] };

export const LIVE_SCENARIOS: readonly LiveScenario[] = [
  { area: 'Gallery', question: 'How many images are in my Aurora Album?', facts: [/\b(?:2|two)\s+images?\b/i, /Aurora Album/i] },
  { area: 'Gallery', question: 'How many MB do the images in this collection use?', facts: [/3[.,]1[45]\d*\s*(?:MB|megabytes)\b/i] },
  { area: 'Gallery', question: 'Which memories do we have in this collection?', facts: [/blue boat/i, /sunset/i] },
  { area: 'Gallery', question: 'Describe the images in Aurora Album.', facts: [/blue boat/i, /red kite/i] },
  { area: 'Gallery', question: 'Which images are in City Nights?', facts: [/blue boat/i, /KUST\s*42/i] },
  { area: 'Gallery', question: 'Do Aurora Album and City Nights contain any of the same images?', facts: [/blue boat/i] },
  { area: 'Gallery', question: 'What words appear on the sign in my City Nights image?', facts: [/KUST\s*42/i] },
  { area: 'Gallery', question: 'Which image in Aurora Album features a kite?', facts: [/red kite/i] },
  { area: 'Gallery', question: 'How many distinct images are saved in my workspace?', facts: [/\b(?:3|three)\b/i, /images?/i] },
  { area: 'Gallery', question: 'What is in the saved highlight for Aurora Album?', facts: [/blue boat/i, /red kite/i] },

  { area: 'Archive', question: 'What does Train Notes say about departure?', facts: [/Stockholm/i, /Friday/i, /09:15/] },
  { area: 'Archive', question: 'List my folders.', facts: [/Travel Notes/i, /Research Folder/i] },
  { area: 'Archive', question: 'Which documents are inside Travel Notes?', facts: [/Train Notes/i, /Harbor Ledger/i] },
  { area: 'Archive', question: 'What does Harbor Ledger say about Pier Seven?', facts: [/Pier Seven/i, /blue boat/i] },
  { area: 'Archive', question: 'What place do Train Notes and Harbor Ledger both mention?', facts: [/Stockholm/i] },
  { area: 'Archive', question: 'What is Sky Survey about?', facts: [/Orion/i] },
  { area: 'Archive', question: 'How many documents have I saved?', facts: [/\b(?:3|three)\s+documents?\b/i] },
  { area: 'Archive', question: 'Which note mentions Pier Seven?', facts: [/Harbor Ledger/i] },
  { area: 'Archive', question: 'Which note is connected to my Nordic Rail journey?', facts: [/Train Notes/i] },
  { area: 'Archive', question: 'Remind me of the precise departure time in my travel notes.', facts: [/09:15/] },

  { area: 'Ascend', question: 'Which audiobooks are in my library?', facts: [/Quiet Astronomy/i, /Harbor History/i] },
  { area: 'Ascend', question: 'How many audiobooks do I have?', facts: [/\b(?:2|two)\s+(?:audio\s*books?|audiobooks?|books?)\b/i] },
  { area: 'Ascend', question: 'Tell me about the audiobook Quiet Astronomy.', facts: [/night sky|stars|astronomy/i, /Moonlight Basics|30 minutes|beginners/i] },
  { area: 'Ascend', question: 'What does the Moonlight Basics chapter explain?', facts: [/moon phases/i, /Orion/i] },
  { area: 'Ascend', question: 'What is the Harbor History audiobook about?', facts: [/harbor|port/i, /boats?/i] },
  { area: 'Ascend', question: 'What happens in the Pier Seven Stories chapter?', facts: [/Pier Seven/i, /blue boat/i] },
  { area: 'Ascend', question: 'How do my two audiobooks differ?', facts: [/astronomy|night sky/i, /harbor|boats?/i] },
  { area: 'Ascend', question: 'How many estimated listening minutes are in my audiobook library?', facts: [/\b75\b|seventy.five/i] },

  { area: 'Compass', question: 'Which places have I saved?', facts: [/Stockholm/i, /Oslo/i] },
  { area: 'Compass', question: 'How many places have I saved?', facts: [/\b(?:2|two)\s+places?\b/i] },
  { area: 'Compass', question: 'Which cities are on my Nordic Rail trip?', facts: [/Stockholm/i, /Oslo/i] },
  { area: 'Compass', question: 'Have I visited Stockholm or is it on my wishlist?', facts: [/visited/i] },
  { area: 'Compass', question: 'What is the saved state of Oslo?', facts: [/wishlist|want.to.go|planned/i] },
  { area: 'Compass', question: 'Which folder and photo collection are attached to Nordic Rail?', facts: [/Travel Notes/i, /City Nights/i, /attach|linked|connected/i], contradictions: [/did not return|cannot confirm|unable to confirm/i] },
  { area: 'Compass', question: 'What does the Stockholm restaurant reference recommend?', facts: [/lingonberry/i, /North Market/i] },
  { area: 'Compass', question: 'What does my Nordic Rail guide say about the departure?', facts: [/Friday/i, /09:15/] },
  { area: 'Compass', question: 'Does Nordic Rail agree with Train Notes about the departure?', facts: [/Friday/i, /09:15/] },

  { area: 'Signal', question: 'How many conversations are in Work Mail?', facts: [/\b(?:2|two)\s+(?:conversations?|threads?|emails?|messages?)\b/i] },
  { area: 'Signal', question: 'Which email subjects do I have in Work Mail?', facts: [/Rail booking confirmation/i, /Gallery share/i] },
  { area: 'Signal', question: 'Who sent the rail booking confirmation?', facts: [/rail@example\.test/i] },
  { area: 'Signal', question: 'When does the rail booking email say the train departs?', facts: [/Friday/i, /09:15/] },
  { area: 'Signal', question: 'Which inbox contains my rail booking?', facts: [/Work Mail/i] },
  { area: 'Signal', question: 'Do I have any email about a blue boat?', facts: [/Gallery share|blue boat/i] },
  { area: 'Signal', question: 'What is the subject of my saved email draft?', facts: [/Reply to booking/i] },
  { area: 'Signal', question: 'Which saved writing tone asks for concise replies?', facts: [/Clear Replies/i] },
  { area: 'Signal', question: 'Compare the booking email with Train Notes: do their departure times match?', facts: [/Friday/i, /09:15/] },

  { area: 'Cross app', question: 'Find everything relevant to Pier Seven across my notes, photos, and books.', facts: [/Harbor Ledger/i, /Pier Seven/i, /Harbor History|Pier Seven Stories/i], contradictions: [/no specific book content|no relevant books?/i] },
  { area: 'Cross app', question: 'Compare City Nights collection with Travel Notes folder: do they connect to the same trip?', facts: [/Nordic Rail/i] },
  { area: 'Cross app', question: 'Hur många bilder finns i Aurora Album?', facts: [/\b(?:2|two|två)\b/i] },
  { area: 'Cross app', question: 'What do my photos, trip, email, and notes jointly tell us about Stockholm?', facts: [/Stockholm/i, /Friday|09:15|train/i, /booking|email|correspondence/i, /Train Notes|Harbor Ledger|notes/i, /City Nights|Aurora Album|photos/i], contradictions: [/no email messages|cannot access (?:your )?email/i] },
];

if (LIVE_SCENARIOS.length !== 50) throw new Error(`Expected exactly 50 paid conversation turns; received ${LIVE_SCENARIOS.length}.`);
