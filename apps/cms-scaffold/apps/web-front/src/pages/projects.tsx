import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { publicQueries } from "@cms/api/public";
import { Card, CardContent, EmptyState, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { text } from "../media";
import { FrontTitle } from "../shell";

export function ProjectsHome() {
  const projects = useQuery(publicQueries.entries(api.public, "project"));
  return (
    <>
      <FrontTitle>{copy["projects.title"]}</FrontTitle>
      <QueryBoundary query={projects} isEmpty={(page) => page.items.length === 0} empty={<EmptyState title={copy["empty.projects"]} />}>
        {(page) => (
          <div className="grid gap-4 sm:grid-cols-2">
            {page.items.map((project) => (
              <Link key={project.id} to={`/projects/${project.slug ?? project.id}`} className="rounded-xl" data-testid="project-card">
                <Card className="h-full">
                  <CardContent>
                    <h2 className="text-front-heading">{project.title}</h2>
                    <p className="text-subdued">{text(project.payload.summary)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

function Milestones({ projectId }: { projectId: string }) {
  const milestones = useQuery(publicQueries.entries(api.public, "milestone", { ref: { project: projectId } }));
  return (
    <QueryBoundary query={milestones} isEmpty={(page) => page.items.length === 0} empty={<EmptyState title={copy["empty.milestones"]} />}>
      {(page) => (
        <ul className="flex flex-col gap-2">
          {page.items.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span className="text-subdued"> · {text(item.payload.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </QueryBoundary>
  );
}

export function ProjectDetail() {
  const { slug = "" } = useParams();
  const project = useQuery(publicQueries.bySlug(api.public, "project", slug));
  return (
    <QueryBoundary
      query={project}
      notFound={
        <>
          <FrontTitle>{copy["project.notFound.title"]}</FrontTitle>
          <p className="text-subdued">{copy["project.notFound.body"]}</p>
        </>
      }
    >
      {(entry) => (
        <>
          <FrontTitle>{entry.title ?? slug}</FrontTitle>
          <p className="mb-6 text-subdued">{text(entry.payload.summary)}</p>
          <h2 className="mb-3 font-display text-front-heading">{copy["project.milestones"]}</h2>
          <Milestones projectId={entry.id} />
        </>
      )}
    </QueryBoundary>
  );
}
