export interface ChorusReactionOption { emoji: string; name: string; keywords: string }

const groups: Array<[string, string, string]> = [
  ["😀", "grinning face", "happy smile"], ["😃", "smiling face", "happy joy"], ["😄", "smile", "happy laugh"], ["😁", "beaming face", "grin"], ["😆", "squinting laugh", "funny"], ["😂", "tears of joy", "laugh funny"], ["🤣", "rolling laughing", "rofl funny"], ["😊", "blush", "happy warm"], ["🙂", "slight smile", "okay"], ["😉", "wink", "playful"],
  ["😍", "heart eyes", "love"], ["🥰", "smiling hearts", "love affection"], ["😘", "kiss", "love"], ["😎", "sunglasses", "cool"], ["🤓", "nerd", "smart"], ["🫡", "salute", "respect"], ["🤔", "thinking", "consider"], ["😴", "sleeping", "tired"], ["😭", "crying", "sad"], ["😡", "angry", "mad"], ["🤯", "mind blown", "amazed"], ["🥳", "party face", "celebrate"], ["😱", "scream", "shocked"], ["👀", "eyes", "looking watch"],
  ["👍", "thumbs up", "yes approve like"], ["👎", "thumbs down", "no disapprove dislike"], ["👏", "clap", "applause"], ["🙌", "raised hands", "celebrate"], ["🫶", "heart hands", "love support"], ["🤝", "handshake", "agreement"], ["🙏", "folded hands", "please thanks"], ["💪", "strong arm", "strength"], ["👌", "okay hand", "perfect"], ["✌️", "victory hand", "peace"], ["🤞", "crossed fingers", "luck"], ["👋", "wave", "hello goodbye"],
  ["🔥", "fire", "hot great"], ["❤️", "red heart", "love"], ["🧡", "orange heart", "love"], ["💛", "yellow heart", "love"], ["💚", "green heart", "love"], ["💙", "blue heart", "love"], ["💜", "purple heart", "love"], ["🖤", "black heart", "love"], ["🤍", "white heart", "love"], ["💔", "broken heart", "sad"], ["💯", "hundred", "perfect score"], ["💥", "collision", "boom"], ["✨", "sparkles", "shine"], ["⭐", "star", "favorite"], ["🌟", "glowing star", "excellent"],
  ["🎉", "party popper", "celebrate"], ["🎊", "confetti", "celebrate"], ["🎁", "gift", "present"], ["🎂", "birthday cake", "celebrate"], ["🚀", "rocket", "launch fast"], ["✅", "check mark", "done yes complete"], ["❌", "cross mark", "no wrong"], ["⚡", "lightning", "fast energy"], ["💡", "light bulb", "idea insight"], ["📌", "pin", "important"], ["📎", "paperclip", "attach"], ["📣", "megaphone", "announce"], ["🔔", "bell", "notify"], ["🎯", "target", "goal"], ["🏆", "trophy", "winner"], ["🥇", "gold medal", "winner"],
  ["📈", "chart increasing", "growth up"], ["📉", "chart decreasing", "decline down"], ["💰", "money bag", "finance"], ["💬", "speech bubble", "chat"], ["🧠", "brain", "smart think"], ["🛠️", "tools", "build fix"], ["🧪", "test tube", "experiment"], ["🔒", "lock", "secure"], ["🔓", "unlock", "open"], ["🌍", "globe", "world"], ["☀️", "sun", "bright"], ["🌙", "moon", "night"], ["☁️", "cloud", "weather"], ["🌈", "rainbow", "color"], ["🌱", "seedling", "growth"], ["🌳", "tree", "nature"],
  ["🐶", "dog", "pet animal"], ["🐱", "cat", "pet animal"], ["🦊", "fox", "animal"], ["🐻", "bear", "animal"], ["🐼", "panda", "animal"], ["🦁", "lion", "animal"], ["🐸", "frog", "animal"], ["🦄", "unicorn", "magic"], ["🐝", "bee", "animal"], ["🦋", "butterfly", "animal"],
  ["🍎", "apple", "food"], ["🍕", "pizza", "food"], ["🍔", "burger", "food"], ["🍿", "popcorn", "food movie"], ["☕", "coffee", "drink"], ["🍺", "beer", "drink"], ["🥂", "cheers", "drink celebrate"], ["⚽", "soccer ball", "sport"], ["🏀", "basketball", "sport"], ["🎮", "video game", "gaming"], ["🎵", "music note", "audio"], ["🎬", "movie", "film"], ["📚", "books", "read learn"], ["✈️", "airplane", "travel"], ["🏠", "house", "home"],
];

export const CHORUS_REACTIONS: ChorusReactionOption[] = groups.map(([emoji, name, keywords]) => ({ emoji, name, keywords }));

export function filterChorusReactions(query: string): ChorusReactionOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return CHORUS_REACTIONS;
  return CHORUS_REACTIONS.filter(({ emoji, name, keywords }) => emoji === normalized || name.includes(normalized) || keywords.includes(normalized));
}
