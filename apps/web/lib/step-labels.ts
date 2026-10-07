/** Bao's read steps in plain words. New turns arrive worded by the API
 *  (ai/agent.py STEP_LABELS); this covers chats saved before that. */
const LABELS: Record<string, string> = {
  list_files: "Looked through your files",
  search_content: "Searched inside your files",
  list_folders: "Checked your folders",
  list_tags: "Checked your tags",
  find_duplicates: "Looked for duplicates",
  read_file_text: "Read a file",
};

export function stepLabel(label: string): string {
  return LABELS[label] ?? label;
}
