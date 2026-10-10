import Markdown, { type Components } from "react-markdown";
import { cn } from "@cms/ui";

// D-08, S-04: no rehype-raw, so raw HTML is never rendered; only these elements survive, the rest is unwrapped to
// its text. Images are not allowed: public media reach the page only through media-ref fields (surface-front §6.2).
const ALLOWED = ["p", "strong", "em", "a", "ul", "ol", "li", "blockquote", "code", "pre", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6"];

// The page owns the only <h1>; Markdown headings start one level below the section they are in.
const COMPONENTS: Components = {
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h4 {...props} />,
  h5: ({ node: _node, ...props }) => <h4 {...props} />,
  h6: ({ node: _node, ...props }) => <h4 {...props} />,
};

export interface MarkdownBodyProps {
  /** A markdown field value. Anything that is not a non-empty string renders nothing. */
  source: unknown;
  className?: string;
  testId?: string;
}

/** C-13: markdown fields (intro, bio, description, summary, hours) rendered as Markdown, text column ≤ 68ch (01 §5.3). */
export function MarkdownBody({ source, className, testId = "markdown-body" }: MarkdownBodyProps) {
  if (typeof source !== "string" || source.trim() === "") return null;
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex max-w-[68ch] flex-col gap-4 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_code]:font-mono [&_h2]:font-display [&_h2]:text-front-heading [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-6",
        className,
      )}
    >
      <Markdown allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
        {source}
      </Markdown>
    </div>
  );
}
