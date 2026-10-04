import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { isApiError, memberQueries, type MemberEntry } from "@cms/api/public";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { APPOINTMENT_TYPE, appointmentStatus, formatMemberDate, MEMBER_LIST_SIZE, memberText, PET_TYPE, petTitle } from "../member";
import { useMemberUnauthorized } from "../member-auth";
import { Crumbs } from "../parts";
import { usePageMeta } from "../seo";
import { FrontTitle } from "../shell";
import { DetailSkeleton, EmptyPublished, ErrorPublic, GridSkeleton, NotFoundPublic, PublicBoundary } from "../states";
const params = { size: MEMBER_LIST_SIZE };
function MemberCrumbs({ current }: { current?: string }) {
  return <Crumbs items={[{ label: copy["site.clinic"], to: "/clinic" }, { label: copy["member.home.title"], ...(current ? { to: "/clinic/me" } : {}) }, ...(current ? [{ label: current }] : [])]} />;
}
function Status({ entry }: { entry: MemberEntry }) {
  return <Badge data-testid="appointment-status">
    {copy[appointmentStatus(entry)]}
  </Badge>;
}
export function MemberForbidden() {
  usePageMeta({ title: copy.forbidden, index: false });
  return <div data-testid="member-forbidden">
    <FrontTitle>
      {copy.forbidden}
    </FrontTitle>
    <p className="mb-6">
      {copy["forbidden.body"]}
    </p>
    <Link to="/clinic/me" className="underline">
      {copy["forbidden.back"]}
    </Link>
  </div>;
}
export function MemberHome() {
  const pets = useQuery(memberQueries.list(api, PET_TYPE, params));
  const appointments = useQuery(memberQueries.list(api, APPOINTMENT_TYPE, params));
  const unauthorized = useMemberUnauthorized(pets.error, appointments.error);
  usePageMeta({ title: copy["member.home.title"], index: false });
  if (unauthorized) return <DetailSkeleton />;
  return <div data-testid="member-home">
    <MemberCrumbs />
    <FrontTitle actions={<Button asChild>
      <Link data-testid="member-new-appointment" to="/clinic/appointments/new">
        {copy["member.menu.new"]}
      </Link>
    </Button>
    }>
      {copy["member.home.title"]}
    </FrontTitle>
    <section className="mb-10" data-testid="member-pets">
      <h2 className="mb-4 font-display text-front-heading">
        {copy["member.pets.title"]}
      </h2>
      <PublicBoundary query={pets} level="section" skeleton={<GridSkeleton />
      } isEmpty={(data) => data.items.length === 0} empty={<EmptyPublished title={copy["empty.me.pets"]} description={copy["empty.me.pets.body"]} />
      }>
        {(data) => <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((pet) => {
            const species = memberText(pet.payload, "species");
            return <Card data-testid="member-pet-card" key={pet.id}>
              <CardHeader>
                <CardTitle>
                  <h3>
                    {pet.title || copy["member.pet.species.other"]}
                  </h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {copy[species === "dog" ? "member.pet.species.dog" : species === "cat" ? "member.pet.species.cat" : "member.pet.species.other"]}
              </CardContent>
            </Card>;
          })}
        </div>
        }
      </PublicBoundary>
    </section>
    <section data-testid="member-appointments">
      <h2 className="mb-4 font-display text-front-heading">
        {copy["member.appointments.title"]}
      </h2>
      <PublicBoundary query={appointments} level="section" skeleton={<GridSkeleton />
      } isEmpty={(data) => data.items.length === 0} empty={<>
        <EmptyPublished title={copy["empty.me.appointments"]} />
        <Link className="underline" to="/clinic/appointments/new">
          {copy["member.menu.new"]}
        </Link>
      </>
      }>
        {(data) => <div className="grid gap-4">
          {data.items.map((entry) => <Card data-testid="member-appointment-card" key={entry.id}>
            <CardHeader>
              <CardTitle>
                <h3>
                  <Link className="underline break-words" to={"/clinic/appointments/" + entry.id}>
                    {entry.title || memberText(entry.payload, "reason") || copy["member.appointment.detail"]}
                  </Link>
                </h3>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span>
                {petTitle(pets.data?.items ?? [], entry.payload.pet) || copy["member.pet.unavailable"]}
              </span>
              <span>
                {formatMemberDate(entry.payload.preferredAt) || copy["member.value.unavailable"]}
              </span>
              <Status entry={entry} />
            </CardContent>
          </Card>)}
        </div>
        }
      </PublicBoundary>
    </section>
  </div>;
}
export function AppointmentDetail() {
  const { id = "" } = useParams();
  const detail = useQuery(memberQueries.detail(api, id));
  const pets = useQuery(memberQueries.list(api, PET_TYPE, params));
  const unauthorized = useMemberUnauthorized(detail.error, pets.error);
  usePageMeta({ title: copy["member.appointment.detail"], index: false });
  if (unauthorized || detail.isPending) return <DetailSkeleton />;
  if (detail.isError) {
    if (isApiError(detail.error) && detail.error.status === 403 && detail.error.code === "FORBIDDEN") return <MemberForbidden />;
    if (isApiError(detail.error) && detail.error.status === 404) return <NotFoundPublic />;
    return <ErrorPublic level="page" onRetry={detail.refetch} />;
  }
  const entry = detail.data;
  if (entry.contentType !== APPOINTMENT_TYPE) return <NotFoundPublic />;
  return <div data-testid="appointment-detail">
    <MemberCrumbs current={copy["member.appointment.detail"]} />
    <FrontTitle actions={<Status entry={entry} />
    }>
      {copy["member.appointment.detail"]}
    </FrontTitle>
    <Card>
      <CardContent>
        <dl className="grid gap-5 pt-6">
          <div>
            <dt className="text-subdued">
              {copy["member.form.pet"]}
            </dt>
            <dd data-testid="appointment-pet">
              {petTitle(pets.data?.items ?? [], entry.payload.pet) || copy["member.pet.unavailable"]}
            </dd>
          </div>
          <div>
            <dt className="text-subdued">
              {copy["member.form.preferredAt"]}
            </dt>
            <dd data-testid="appointment-time">
              {formatMemberDate(entry.payload.preferredAt) || copy["member.value.unavailable"]}
            </dd>
          </div>
          <div>
            <dt className="text-subdued">
              {copy["member.form.reason"]}
            </dt>
            <dd className="whitespace-pre-wrap break-words" data-testid="appointment-reason">
              {memberText(entry.payload, "reason") || copy["member.value.unavailable"]}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  </div>;
}
