import type { RagStrategies } from "@byos/api-client";

/** One chat add-on, as shown in the chat's + menu and in Settings → Chat.
 *  `tech` is the name it goes by in the literature, for those who know it. */
export type AddonInfo = { key: keyof RagStrategies; label: string; tech: string; hint: string };

/** Extra steps when searching file contents. Each adds a model call. */
export const SEARCH_ADDONS: AddonInfo[] = [
  { key: "rewrite", label: "Rewrite the question", tech: "Query rewriting", hint: "Turns it into a better search first" },
  { key: "hyde", label: "Search with a draft answer", tech: "HyDE", hint: "Writes a likely answer and searches with that" },
  { key: "rerank", label: "Rerank results", tech: "LLM reranking", hint: "Has the model keep the most useful passages" },
  { key: "crag", label: "Retry weak searches", tech: "Corrective RAG", hint: "Searches again if results look thin" },
];

/** How the answer is written. */
export const ANSWER_ADDONS: AddonInfo[] = [
  { key: "reasoning", label: "Show reasoning", tech: "Chain of thought", hint: "Shows the steps and calculations behind the answer" },
];

export const ALL_ADDONS = [...SEARCH_ADDONS, ...ANSWER_ADDONS];
