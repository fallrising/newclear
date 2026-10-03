import MarkdownIt from "markdown-it";

export const md = new MarkdownIt("zero", { html: false, linkify: true, breaks: true });
md.enable(["fence", "blockquote", "list", "paragraph"]);
md.enable(["text", "linkify", "newline", "escape", "backticks", "emphasis", "link", "autolink"]);
md.enable(["balance_pairs", "fragments_join"]);
md.enable(["normalize", "block", "inline", "linkify", "text_join"]);
md.validateLink = (url: string): boolean => /^(https?:|mailto:)/i.test(url.trim());
