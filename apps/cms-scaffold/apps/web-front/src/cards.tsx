import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import type { PublicEntry } from "@cms/api/public";
import { Card, CardContent, cn } from "@cms/ui";
import { copy } from "./copy";
import { altOf, formatDate, imageOf, text } from "./media";
import { EnumBadge, PublicImage } from "./parts";
import { summarize } from "./seo";
import type { CardKind } from "./sites";

export interface CardProps {
  entry: PublicEntry;
  /** 2 on a list page (under the h1), 3 inside a home section (under its h2). */
  level: 2 | 3;
}

function CardTitle({ level, children }: { level: 2 | 3; children: ReactNode }) {
  const Tag = level === 2 ? "h2" : "h3";
  return <Tag className="font-display text-front-heading">{children}</Tag>;
}

/** Whole card is one link when the entry has a slug (surface-front §4.2: links use slugs, never ids). */
function CardLink({ to, testId, children }: { to: string | null; testId: string; children: ReactNode }) {
  if (!to) {
    return (
      <div className="h-full" data-testid={testId}>
        {children}
      </div>
    );
  }
  return (
    <Link to={to} className="block h-full rounded-xl" data-testid={testId}>
      {children}
    </Link>
  );
}

function Excerpt({ value }: { value: unknown }) {
  const plain = summarize(value, 140);
  return plain ? <p className="line-clamp-2 text-subdued">{plain}</p> : null;
}

/** Album card (surface-front §7.4 whitelist: title, description, cover). 4:3 cover, thumbnail variant. */
export function AlbumCard({ entry, level }: CardProps) {
  const cover = imageOf(entry.payload.cover, "thumbnail");
  return (
    <CardLink to={entry.slug ? `/album/albums/${entry.slug}` : null} testId="album-card">
      <Card className="h-full gap-4 overflow-hidden pt-0 hover:bg-accent">
        {cover ? (
          <PublicImage image={cover} alt={altOf(entry.payload.cover)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="aspect-[4/3] w-full bg-surface-subdued" aria-hidden="true" />
        )}
        <CardContent className="flex flex-col gap-2">
          <CardTitle level={level}>{entry.title ?? entry.slug ?? ""}</CardTitle>
          <Excerpt value={entry.payload.description} />
        </CardContent>
      </Card>
    </CardLink>
  );
}

/** Vet card (01 §7.1 F-S4): photo, name, specialty badge, first two lines of the bio. */
export function VetCard({ entry, level }: CardProps) {
  const photo = imageOf(entry.payload.photo, "thumbnail");
  return (
    <CardLink to={entry.slug ? `/clinic/vets/${entry.slug}` : null} testId="vet-card">
      <Card className={cn("h-full gap-4 overflow-hidden hover:bg-accent", photo && "pt-0")}>
        {photo ? (
          <PublicImage image={photo} alt={altOf(entry.payload.photo)} loading="lazy" className="aspect-square w-full object-cover" />
        ) : null}
        <CardContent className="flex flex-col gap-2">
          <CardTitle level={level}>{entry.title ?? ""}</CardTitle>
          <div>
            <EnumBadge type="vet" field="specialty" value={entry.payload.specialty} />
          </div>
          <Excerpt value={entry.payload.bio} />
        </CardContent>
      </Card>
    </CardLink>
  );
}

/** Project card (surface-front §7.4 whitelist: title, summary, cover; lifecycle badge). */
export function ProjectCard({ entry, level }: CardProps) {
  const cover = imageOf(entry.payload.cover, "thumbnail");
  return (
    <CardLink to={entry.slug ? `/projects/${entry.slug}` : null} testId="project-card">
      <Card className={cn("h-full gap-4 overflow-hidden hover:bg-accent", cover && "pt-0")}>
        {cover ? (
          <PublicImage image={cover} alt={altOf(entry.payload.cover)} loading="lazy" className="aspect-[4/3] w-full object-cover" />
        ) : null}
        <CardContent className="flex flex-col gap-2">
          <CardTitle level={level}>{entry.title ?? entry.slug ?? ""}</CardTitle>
          <div>
            <EnumBadge type="project" field="lifecycle" value={entry.payload.lifecycle} />
          </div>
          <Excerpt value={entry.payload.summary} />
        </CardContent>
      </Card>
    </CardLink>
  );
}

export const CARDS: Record<CardKind, ComponentType<CardProps>> = { album: AlbumCard, vet: VetCard, project: ProjectCard };

const DOT: Record<string, string> = {
  reached: "border-success bg-success",
  missed: "border-critical bg-critical",
};

/** F-S5 milestone timeline. Issues are never requested or shown (surface-front AC-06). */
export function MilestoneTimeline({ items, projectSlug }: { items: PublicEntry[]; projectSlug: string }) {
  return (
    <ol className="flex flex-col" data-testid="milestone-timeline">
      {items.map((item, i) => {
        const due = formatDate(item.payload.dueDate);
        const status = text(item.payload.status);
        return (
          <li key={item.id} className="relative flex gap-4 pb-6" data-testid="milestone-item">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className={cn("mt-1.5 size-3 rounded-full border-2 border-border-strong", DOT[status])} />
              {i < items.length - 1 ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {item.slug ? (
                <Link to={`/projects/${projectSlug}/milestones/${item.slug}`} className="font-semibold hover:underline">
                  {item.title ?? item.slug}
                </Link>
              ) : (
                <span className="font-semibold">{item.title ?? ""}</span>
              )}
              <EnumBadge type="milestone" field="status" value={item.payload.status} />
              {due ? (
                <span className="text-subdued">
                  {copy["milestone.due"]} {due}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
