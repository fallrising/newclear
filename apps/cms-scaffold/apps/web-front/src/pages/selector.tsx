import { Link } from "react-router";
import { Card, CardDescription, CardHeader, CardTitle, TitleSuffixContext, useDocumentTitle } from "@cms/ui";
import { copy } from "../copy";

const CARDS = [
  { to: "/album", title: copy["selector.album.title"], body: copy["selector.album.body"] },
  { to: "/clinic", title: copy["selector.clinic.title"], body: copy["selector.clinic.body"] },
  { to: "/projects", title: copy["selector.projects.title"], body: copy["selector.projects.body"] },
];

function SelectorBody() {
  useDocumentTitle(null);
  return (
    <main id="main" className="mx-auto max-w-[1200px] px-4 py-12">
      <h1 className="text-front-title">{copy["selector.title"]}</h1>
      <p className="mb-8 text-subdued">{copy["selector.lead"]}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        {CARDS.map((card) => (
          <Link key={card.to} to={card.to} className="rounded-xl">
            <Card className="h-full hover:bg-accent">
              <CardHeader>
                <CardTitle>
                  <h2 className="text-front-heading">{card.title}</h2>
                </CardTitle>
                <CardDescription>{card.body}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function SelectorPage() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector" className="min-h-screen bg-page text-foreground text-front-body">
        <SelectorBody />
      </div>
    </TitleSuffixContext.Provider>
  );
}
