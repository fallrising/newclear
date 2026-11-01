import MarkdownIt from "markdown-it";

function parser(reading: boolean): InstanceType<typeof MarkdownIt> {
  const instance = new MarkdownIt("zero", { html: false, linkify: true, breaks: true });
  instance.enable(["fence", "blockquote", "list", "paragraph"]);
  if (reading) instance.enable("heading");
  instance.enable(["text", "linkify", "newline", "escape", "backticks", "emphasis", "link", "autolink"]);
  instance.enable(["balance_pairs", "fragments_join"]);
  instance.enable(["normalize", "block", "inline", "linkify", "text_join"]);
  instance.validateLink = (url: string): boolean => /^(https?:|mailto:)/i.test(url.trim()) ||
    (reading && /^\/reading\/[A-Za-z0-9_-]{1,128}$/.test(url));
  return instance;
}

export const md = parser(false);
export const readingMd = parser(true);
