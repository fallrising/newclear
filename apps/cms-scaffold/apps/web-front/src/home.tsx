import type { ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries } from "@cms/api/public";
import { Card, CardContent, CardHeader, CardTitle } from "@cms/ui";
import { api } from "./api";
import { CARDS } from "./cards";
import { copy, type CopyKey } from "./copy";
import { MarkdownBody } from "./markdown";
import { text } from "./media";
import { Crumbs, type Crumb } from "./parts";
import { usePageMeta } from "./seo";
import { FrontTitle } from "./shell";
import { SITES, type GridSpec, type SectionSpec, type SiteKey } from "./sites";
import { EmptyPublished, ErrorPublic, GridSkeleton, HeroSkeleton, ListPager, pageSearch, PublicBoundary, readPage } from "./states";

type HeroSpec = Extract<SectionSpec, { section: "Hero" }>;

function HeroView({ title, lead }: { title: string; lead: ReactNode }) {
  return (
    <section className="mb-10" data-testid="site-hero">
      <FrontTitle documentTitle={null}>{title}</FrontTitle>
      {lead}
    </section>
  );
}

function FallbackLead({ copyKey }: { copyKey: CopyKey }) {
  return <p className="max-w-[68ch] text-subdued">{copy[copyKey]}</p>;
}

/** Hero from a public page entry; any failure (404 included) shows the fallback, the hero is not the page's content. */
function PageHero({ spec, source }: { spec: HeroSpec; source: { type: string; slug: string } }) {
  const page = useQuery(publicQueries.bySlug(api.public, source.type, source.slug));
  if (page.isPending) return <HeroSkeleton />;
  if (page.isError) return <HeroView title={copy[spec.fallback.title]} lead={<FallbackLead copyKey={spec.fallback.lead} />} />;
  return (
    <HeroView
      title={page.data.title ?? copy[spec.fallback.title]}
      lead={<MarkdownBody source={page.data.payload.body} className="text-subdued" />}
    />
  );
}

function Hero({ spec }: { spec: HeroSpec }) {
  if (spec.source === null) return <HeroView title={copy[spec.fallback.title]} lead={<FallbackLead copyKey={spec.fallback.lead} />} />;
  return <PageHero spec={spec} source={spec.source} />;
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>
          <h2 className="text-subdued">{title}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** F-S4: the clinic_profile singleton — name, intro (Markdown), address, telephone, hours. */
function ClinicProfile({ type }: { type: string }) {
  const profile = useQuery(publicQueries.entries(api.public, type, { size: 1 }));
  if (profile.isPending) return <HeroSkeleton />;
  const fallbackTitle = <FrontTitle documentTitle={null}>{copy["clinic.fallbackTitle"]}</FrontTitle>;
  if (profile.isError) {
    return (
      <section className="mb-10">
        {fallbackTitle}
        <ErrorPublic level="section" onRetry={profile.refetch} />
      </section>
    );
  }
  const entry = profile.data.items[0];
  if (!entry) return <section className="mb-10">{fallbackTitle}</section>;
  const address = text(entry.payload.address);
  const telephone = text(entry.payload.telephone);
  const hours = text(entry.payload.hours);
  return (
    <section className="mb-10" data-testid="clinic-profile">
      <FrontTitle documentTitle={null}>{entry.title ?? copy["clinic.fallbackTitle"]}</FrontTitle>
      <MarkdownBody source={entry.payload.intro} className="mb-6" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {address ? (
          <InfoCard title={copy["clinic.address"]}>
            <p>{address}</p>
          </InfoCard>
        ) : null}
        {telephone ? (
          <InfoCard title={copy["clinic.telephone"]}>
            <a href={`tel:${telephone.replace(/[^0-9+]/g, "")}`} className="underline">
              {telephone}
            </a>
          </InfoCard>
        ) : null}
        {hours ? (
          <InfoCard title={copy["clinic.hours"]}>
            <MarkdownBody source={hours} />
          </InfoCard>
        ) : null}
      </div>
    </section>
  );
}

/**
 * A card grid of one public type (01 §6.3 CollectionGrid). `heading`: true inside a site home (h2 + "all" link,
 * cards use h3); false on a list page (the page has the h1, cards use h2).
 */
export function CollectionGrid({ grid, heading }: { grid: GridSpec; heading: boolean }) {
  const [params] = useSearchParams();
  const page = grid.paged ? readPage(params) : 1;
  const params_ = { size: grid.size, ...(page > 1 ? { page } : {}), ...(grid.sort ? { sort: grid.sort } : {}) };
  const query = useQuery(publicQueries.entries(api.public, grid.type, params_));
  const CardView = CARDS[grid.card];
  return (
    <section className="mb-10" data-testid={`grid-${grid.type}`}>
      {heading ? (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-front-heading">{copy[grid.title]}</h2>
          {grid.all ? (
            <Link to={grid.all.to} className="underline">
              {copy[grid.all.label]}
            </Link>
          ) : null}
        </div>
      ) : null}
      <PublicBoundary
        query={query}
        level="section"
        skeleton={<GridSkeleton square={grid.card === "vet"} />}
        isEmpty={(data) => data.total === 0}
        empty={<EmptyPublished title={copy[grid.empty]} description={grid.emptyBody ? copy[grid.emptyBody] : undefined} />}
      >
        {(data) =>
          data.items.length === 0 ? (
            // ?page= past the last page: go to the last page (W3-FM12).
            <Navigate to={{ search: pageSearch(params, Math.ceil(data.total / grid.size)) }} replace />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((entry) => (
                  <CardView key={entry.id} entry={entry} level={heading ? 3 : 2} />
                ))}
              </div>
              {grid.paged ? <ListPager page={page} size={grid.size} total={data.total} /> : null}
            </>
          )
        }
      </PublicBoundary>
    </section>
  );
}

function Section({ spec }: { spec: SectionSpec }) {
  switch (spec.section) {
    case "Hero":
      return <Hero spec={spec} />;
    case "ClinicProfile":
      return <ClinicProfile type={spec.source.type} />;
    case "CollectionGrid":
      return <CollectionGrid grid={spec.grid} heading />;
  }
}

/** A site home: the sections of SITES[site].home in order (01 §6.3). document.title is the site name alone. */
export function SiteHome({ site }: { site: SiteKey }) {
  const def = SITES[site];
  usePageMeta({ title: def.name, description: def.description, index: true });
  return (
    <>
      {def.home.map((spec, i) => (
        <Section key={`${spec.section}-${i}`} spec={spec} />
      ))}
    </>
  );
}

export function AlbumHome() {
  return <SiteHome site="album" />;
}

export function ClinicHome() {
  return <SiteHome site="clinic" />;
}

export function ProjectsHome() {
  return <SiteHome site="projects" />;
}

export interface ListPageProps {
  grid: GridSpec;
  title: string;
  crumbs: Crumb[];
  description: string;
}

/** A paged list page: breadcrumb, h1, CollectionGrid without its own heading. */
export function ListPage({ grid, title, crumbs, description }: ListPageProps) {
  usePageMeta({ title, description, index: true });
  return (
    <>
      <Crumbs items={crumbs} />
      <FrontTitle>{title}</FrontTitle>
      <CollectionGrid grid={grid} heading={false} />
    </>
  );
}
