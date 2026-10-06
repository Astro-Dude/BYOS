/** A question typed on the landing page before signing in. It's kept for this
 *  tab only, and after sign-in the user lands in the chat with it filled in
 *  (not sent: that needs a key and costs tokens, so they press Enter). */
const KEY = "byos:pending-question";

export function savePendingQuestion(question: string): void {
  try {
    sessionStorage.setItem(KEY, question.slice(0, 2000));
  } catch {
    /* storage unavailable: they'll just type it again */
  }
}

export function hasPendingQuestion(): boolean {
  try {
    return !!sessionStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** The question, once: reading it clears it. */
export function takePendingQuestion(): string | null {
  try {
    const q = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return q;
  } catch {
    return null;
  }
}

/** Where to go after signing in: the chat when a question is waiting. */
export function homeAfterSignIn(): string {
  return hasPendingQuestion() ? "/byok" : "/dashboard";
}
