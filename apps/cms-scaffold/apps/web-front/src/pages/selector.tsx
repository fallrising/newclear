import { Link } from "react-router";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle, TitleSuffixContext, useDocumentTitle } from "@cms/ui";
import { copy } from "../copy";
import { usePageMeta } from "../seo";
import { SkipLink } from "../shell";

const CARDS = [
  { to: "/album", title: copy["selector.album.title"], body: copy["selector.album.body"] },
  { to: "/clinic", title: copy["selector.clinic.title"], body: copy["selector.clinic.body"] },
  { to: "/projects", title: copy["selector.projects.title"], body: copy["selector.projects.body"] },
];

/** U-05: the selector has its own header, hero and footer; noindex (surface-front §4.2, AC-01). */
function SelectorBody() {
  useDocumentTitle(null);
  usePageMeta({ title: copy["selector.title"], description: copy["selector.lead"], index: false });
  return (
    <>
      <header className="border-b">
        <div className="mx-auto max-w-[1200px] px-4 py-4 font-display text-front-heading">{copy["footer.name"]}</div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-12 outline-none">
        <section className="mb-10">
          <h1 className="font-display text-front-title">{copy["selector.title"]}</h1>
          <p className="mt-2 max-w-[68ch] text-subdued">{copy["selector.lead"]}</p>
        </section>
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {CARDS.map((card) => (
            <li key={card.to}>
              <Link to={card.to} className="block h-full rounded-xl" data-testid="selector-card">
                <Card className="h-full hover:bg-accent">
                  <CardHeader>
                    <CardTitle>
                      <h2 className="font-display text-front-heading">{card.title}</h2>
                    </CardTitle>
                    <CardDescription>{card.body}</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto underline">{copy["selector.enter"]}</CardFooter>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <footer className="border-t">
        <div className="mx-auto max-w-[1200px] px-4 py-6 text-subdued">{copy["selector.footer"]}</div>
      </footer>
    </>
  );
}

export function SelectorPage() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector" className="flex min-h-screen flex-col bg-page text-foreground text-front-body">
        <SkipLink />
        <SelectorBody />
      </div>
    </TitleSuffixContext.Provider>
  );
}
