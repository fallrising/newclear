import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries, type PublicEntry } from "@cms/api/public";
import { fill } from "@cms/ui";
import { api } from "../api";
import { MilestoneTimeline } from "../cards";
import { copy } from "../copy";
import { MarkdownBody } from "../markdown";
import { altOf, formatDate, imageOf, text } from "../media";
import { Crumbs, EnumBadge, PublicImage } from "../parts";
import { summarize, usePageMeta } from "../seo";
import { FrontTitle } from "../shell";
import { DetailSkeleton, EmptyPublished, GridSkeleton, NotFoundPublic, PublicBoundary } from "../states";

/** Milestones of one project in public order (the milestone type's sortField). Never the issue type (AC-06). */
function projectMilestones(projectId: string, size: number) {
  return publicQueries.entries(api.public, "milestone", { ref: { project: projectId }, size });
}

function Milestones({ project, size }: { project: PublicEntry; size: number }) {
  const milestones = useQuery(projectMilestones(project.id, size));
  return (
    <PublicBoundary
      query={milestones}
      level="section"
      skeleton={<GridSkeleton />}
      isEmpty={(data) => data.items.length === 0}
      empty={<EmptyPublished title={copy["empty.milestones"]} />}
    >
      {(data) => <MilestoneTimeline items={data.items} projectSlug={project.slug ?? ""} />}
    </PublicBoundary>
  );
}

/** Loads the project of a project route; 404/403 → NotFoundPublic (private and unpublished projects look the same, AC-05). */
function useProject() {
  const { slug = "" } = useParams();
  return useQuery(publicQueries.bySlug(api.public, "project", slug));
}

/** F-S5 project page: lifecycle badge, summary, cover, the first 5 milestones and a link to all of them. */
function ProjectView({ project }: { project: PublicEntry }) {
  const title = project.title ?? project.slug ?? "";
  const cover = imageOf(project.payload.cover, "web");
  usePageMeta({ title, description: summarize(project.payload.summary), image: cover?.src ?? null, index: true });
  return (
    <>
      <Crumbs items={[{ label: copy["site.projects"], to: "/projects" }, { label: title }]} />
      <FrontTitle actions={<EnumBadge type="project" field="lifecycle" value={project.payload.lifecycle} />}>{title}</FrontTitle>
      <MarkdownBody source={project.payload.summary} className="mb-8" />
      {cover ? (
        <PublicImage image={cover} alt={altOf(project.payload.cover)} loading="eager" className="mb-8 h-auto w-full max-w-3xl rounded-xl" />
      ) : null}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-display text-front-heading">{copy["project.milestones"]}</h2>
        <Link to={`/projects/${project.slug}/milestones`} className="underline">
          {copy["project.milestones.all"]}
        </Link>
      </div>
      <Milestones project={project} size={5} />
    </>
  );
}

export function ProjectPage() {
  const project = useProject();
  return (
    <PublicBoundary query={project} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <ProjectView project={entry} />}
    </PublicBoundary>
  );
}

function MilestoneListView({ project }: { project: PublicEntry }) {
  const projectTitle = project.title ?? project.slug ?? "";
  const title = fill(copy["milestones.title"], { project: projectTitle });
  usePageMeta({ title, description: summarize(project.payload.summary), image: null, index: true });
  return (
    <>
      <Crumbs
        items={[
          { label: copy["site.projects"], to: "/projects" },
          { label: projectTitle, to: `/projects/${project.slug}` },
          { label: copy["project.milestones"] },
        ]}
      />
      <FrontTitle>{title}</FrontTitle>
      <Milestones project={project} size={100} />
    </>
  );
}

export function MilestoneList() {
  const project = useProject();
  return (
    <PublicBoundary query={project} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <MilestoneListView project={entry} />}
    </PublicBoundary>
  );
}

function MilestoneView({ project, milestone }: { project: PublicEntry; milestone: PublicEntry }) {
  const projectTitle = project.title ?? project.slug ?? "";
  const title = milestone.title ?? milestone.slug ?? "";
  const due = formatDate(milestone.payload.dueDate);
  usePageMeta({ title, description: summarize(milestone.payload.description), image: null, index: true });
  return (
    <>
      <Crumbs
        items={[
          { label: copy["site.projects"], to: "/projects" },
          { label: projectTitle, to: `/projects/${project.slug}` },
          { label: copy["project.milestones"], to: `/projects/${project.slug}/milestones` },
          { label: title },
        ]}
      />
      <FrontTitle actions={<EnumBadge type="milestone" field="status" value={milestone.payload.status} />}>{title}</FrontTitle>
      {due ? (
        <dl className="mb-6 flex gap-2 text-subdued">
          <dt>{copy["milestone.due"]}</dt>
          <dd data-testid="milestone-due">{due}</dd>
        </dl>
      ) : null}
      <MarkdownBody source={milestone.payload.description} />
    </>
  );
}

function MilestoneOfProject({ project }: { project: PublicEntry }) {
  const { mSlug = "" } = useParams();
  const milestone = useQuery(publicQueries.bySlug(api.public, "milestone", mSlug));
  return (
    <PublicBoundary query={milestone} level="page" skeleton={<DetailSkeleton />}>
      {(entry) =>
        // A milestone of another project under this project's path is not this page (W3-FM11).
        text(entry.payload.project) === project.id ? <MilestoneView project={project} milestone={entry} /> : <NotFoundPublic />
      }
    </PublicBoundary>
  );
}

export function MilestonePage() {
  const project = useProject();
  return (
    <PublicBoundary query={project} level="page" skeleton={<DetailSkeleton />}>
      {(entry) => <MilestoneOfProject project={entry} />}
    </PublicBoundary>
  );
}
