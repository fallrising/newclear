import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useParams } from "react-router";
import { parseBundle, type ReadingBundle } from "../../../../reading/bundle";
import { useMe } from "../../api/auth";
import { apiFetch, ApiError } from "../../api/client";
import { useT } from "../../copy";
import { Markdown } from "../../markdown/Markdown";
import { NoteEditor, type NoteDraft } from "./NoteEditor";
import { ExportTokens } from "./ExportTokens";

export function ReadingPage(): ReactElement | null {
  const me = useMe().data;
  const t = useT();
  if (!me) return null;
  if (me.is_operator !== 1) return <section className="p-6">
    <h1 className="text-xl font-semibold">{t("captures.forbidden")}</h1>
    <Link to="/" className="text-accent-strong underline">{t("captures.back")}</Link>
  </section>;
  return <OperatorReading key={me.id} />;
}

function OperatorReading(): ReactElement {
  const t = useT();
  const { articleId } = useParams<{ articleId: string }>();
  const drafts = useRef(new Map<string, NoteDraft>());
  const [bundle, setBundle] = useState<ReadingBundle | null>(null);
  const [failed, setFailed] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timeout: number | undefined;
    async function refresh(): Promise<void> {
      if (controller) return;
      const current = new AbortController();
      controller = current;
      timeout = window.setTimeout(() => current.abort(), 15_000);
      try {
        const value = await apiFetch<unknown>("/api/reading", { signal: current.signal });
        const next = parseBundle(value);
        if (!next) throw new Error("invalid reading bundle");
        if (!active) return;
        // Catalog, commit and bodies move together in one state update.
        setBundle((previous) => previous?.commit === next.commit ? previous : next);
        setFailed(false);
        setUnauthorized(false);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setBundle(null);
          setUnauthorized(true);
        }
        setFailed(true);
      } finally {
        window.clearTimeout(timeout);
        controller = null;
      }
    }
    const focus = (): void => { void refresh(); };
    void refresh();
    const interval = window.setInterval(focus, 5000);
    window.addEventListener("focus", focus);
    return () => { active = false; controller?.abort(); window.clearTimeout(timeout); window.clearInterval(interval); window.removeEventListener("focus", focus); };
  }, []);

  const article = bundle?.articles.find((item) => item.id === articleId);
  return <section className="flex-1 min-h-0 overflow-y-auto">
    <div className="mx-auto w-full max-w-3xl p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("reading.title")}</h1>
        <Link to="/" className="text-accent-strong underline">{t("captures.back")}</Link>
      </header>
      {failed && <p data-testid="reading-status" role="status">{t(unauthorized ? "captures.forbidden" : bundle ? "reading.refreshFailed" : "reading.loadFailed")}</p>}
      {!bundle && !failed && <p role="status">{t("app.loading")}</p>}
      {bundle && <>
        <p className="text-sm text-ink-2 break-all">{t("reading.commit")} <code data-testid="reading-commit">{bundle.commit}</code></p>
        <nav aria-label={t("reading.catalog")}><ul className="flex flex-wrap gap-3">
          {bundle.articles.map((item) => <li key={item.id}><Link data-testid={"reading-link-" + item.id} to={"/reading/" + item.id}
            aria-current={articleId === item.id ? "page" : undefined} className="text-accent-strong underline">{item.title}</Link></li>)}
        </ul></nav>
        {!articleId && <p className="text-ink-2">{t(bundle.articles.length ? "reading.choose" : "reading.empty")}</p>}
        {articleId && <>
          {article ? <article className="space-y-3">
            <h2 className="text-xl font-semibold">{article.title}</h2>
            <p className="text-sm text-ink-2">{t("reading.aiBody")}</p>
            <div data-testid="reading-body" className="space-y-2 break-words [overflow-wrap:anywhere]"><Markdown source={article.body} mentionHandles={[]} reading /></div>
          </article> : <p>{t("reading.missing")}</p>}
          <hr className="border-border" />
          {/^[A-Za-z0-9_-]{1,128}$/.test(articleId) && <NoteEditor key={articleId} articleId={articleId} drafts={drafts.current} />}
        </>}
      </>}
      {!unauthorized && <ExportTokens />}
    </div>
  </section>;
}
