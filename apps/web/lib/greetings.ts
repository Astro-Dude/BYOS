/** BYOK's home-screen line, a different one each time a chat starts. Bao's
 *  voice: dry, a bit cheeky, never about anyone's actual files. */

const ANY_TIME = [
  "Your files called. They'd like to be found.",
  "Ask me anything. Except where your other sock went.",
  "I've seen your Downloads folder. I'm not mad, just disappointed.",
  "final_FINAL_v7.docx? Your secret's safe with me.",
  "Ctrl+F, but it's a panda and it reads.",
  "Somewhere in here is the receipt you need. Let's go get it.",
  "I don't judge your folder structure. Out loud.",
  "What are we hunting: a PDF, a photo, or your will to organise?",
  "Bamboo chewed, paws stretched. Point me at a file.",
  "Every Untitled (14).pdf deserves a second chance.",
  "Ask a question, get an answer, keep the credit.",
  "I read the fine print so you don't have to.",
  "Let's turn \"where did I save that\" into \"oh, there it is\".",
  "Fun fact: 90% of screenshots are never opened again. Let's beat the odds.",
  "Need a file? I fetch better than a golden retriever.",
];

const MORNING = [
  "Morning! Coffee for you, bamboo for me. What are we finding?",
  "Early start? The files are still asleep. Let's wake one up.",
];
const AFTERNOON = [
  "Post-lunch slump? I'll do the reading, you do the nodding.",
  "Afternoon. Perfect time to find that thing from this morning.",
];
const EVENING = [
  "Evening. Let's find it before dinner gets cold.",
  "Winding down? One quick question, then bamboo.",
];
const NIGHT = [
  "Up late? Me too. Files don't find themselves at 2 a.m.",
  "The night is dark and full of unnamed PDFs.",
];

/** The part of the day an hour (0-23, the viewer's local time) belongs to.
 *  Every hour is named once, so the small hours are night, not afternoon. */
export function partOfDay(hour: number): "morning" | "afternoon" | "evening" | "night" {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night"; // 22:00 to 04:59
}

const BY_PART = { morning: MORNING, afternoon: AFTERNOON, evening: EVENING, night: NIGHT };

/** A greeting for right now: mostly the evergreen ones (which never mention a
 *  time of day), sometimes one that matches the viewer's clock. */
export function pickGreeting(now = new Date()): string {
  const timely = BY_PART[partOfDay(now.getHours())];
  const pool = Math.random() < 0.3 ? timely : ANY_TIME;
  return pool[Math.floor(Math.random() * pool.length)]!;
}
