import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { Token } from "markdown-it";
import { useT } from "../copy";
import { IconButton } from "../ui/IconButton";
import { findMentions } from "./mentions";
import { md } from "./md";

// Tokens → React elements; no raw HTML injection and no string rendering (FE-02, BR-34).

function CodeBlock(props: { token: Token }): ReactElement {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  const { token } = props;
  return (
    <div data-testid="md-code" className="my-2 rounded-sm border border-border bg-surface-2">
      <div className="flex items-center justify-between px-3 py-1 text-xs text-ink-3">
        <span data-testid="md-code-lang">{token.info.trim().split(/\s+/)[0] ?? ""}</span>
        <IconButton
          data-testid="md-code-copy"
          label={t(copied ? "md.code.copied" : "md.code.copy")}
          icon={copied ? Check : Copy}
          onClick={() =>
            void navigator.clipboard.writeText(token.content).then(
              () => setCopied(true),
              () => {},
            )
          }
        />
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-sm">
        <code>{token.content.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

function mentionNodes(content: string, handles: readonly string[], key: string): ReactNode[] {
  const ranges = findMentions(content, handles);
  if (ranges.length === 0) return [content];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(content.slice(cursor, range.start));
    nodes.push(
      <span key={key + "m" + index} data-testid="mention" data-handle={range.handle} className="rounded-sm bg-mention-tint px-0.5 font-medium text-ink">
        {content.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

/** Build React nodes from a flat token list, pairing *_open / *_close. */
function render(tokens: Token[], keyPrefix: string, handles: readonly string[]): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    const key = keyPrefix + i;
    if (tok.nesting === 1) {
      // Find the matching close at the same level.
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        depth += tokens[j]!.nesting;
        if (depth > 0) j++;
      }
      const children = render(tokens.slice(i + 1, j), key + ".", handles);
      out.push(wrap(tok, children, key));
      i = j + 1;
      continue;
    }
    if (tok.type === "inline") out.push(...render(tok.children ?? [], key + ".", handles));
    else if (tok.type === "text") out.push(...mentionNodes(tok.content, handles, key));
    else if (tok.type === "softbreak" || tok.type === "hardbreak") out.push(<br key={key} />);
    else if (tok.type === "code_inline")
      out.push(
        <code key={key} className="font-mono text-sm bg-surface-2 rounded-sm px-1">
          {tok.content}
        </code>,
      );
    else if (tok.type === "fence") out.push(<CodeBlock key={key} token={tok} />);
    else if (tok.content) out.push(tok.content);
    i++;
  }
  return out;
}

function wrap(tok: Token, children: ReactNode[], key: string): ReactNode {
  switch (tok.type) {
    case "paragraph_open":
      if (tok.hidden) return <span key={key}>{children}</span>;
      return (
        <p key={key} className="whitespace-pre-wrap break-words">
          {children}
        </p>
      );
    case "strong_open":
      return (
        <strong key={key} className="font-semibold">
          {children}
        </strong>
      );
    case "em_open":
      return <em key={key}>{children}</em>;
    case "bullet_list_open":
      return (
        <ul key={key} className="list-disc pl-6">
          {children}
        </ul>
      );
    case "ordered_list_open": {
      const start = tok.attrGet("start");
      return (
        <ol key={key} className="list-decimal pl-6" start={start ? Number(start) : undefined}>
          {children}
        </ol>
      );
    }
    case "list_item_open":
      return <li key={key}>{children}</li>;
    case "blockquote_open":
      return (
        <blockquote key={key} className="border-l-2 border-border-strong pl-3 text-ink-2">
          {children}
        </blockquote>
      );
    case "link_open": {
      const href = String(tok.attrGet("href") ?? "");
      if (!md.validateLink(href)) return <span key={key}>{children}</span>;
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-strong underline">
          {children}
        </a>
      );
    }
    default:
      return <span key={key}>{children}</span>;
  }
}

export function Markdown(props: { source: string; mentionHandles: readonly string[] }): ReactElement {
  const tokens = useMemo(() => md.parse(props.source, {}), [props.source]);
  return <>{render(tokens, "", props.mentionHandles)}</>;
}
