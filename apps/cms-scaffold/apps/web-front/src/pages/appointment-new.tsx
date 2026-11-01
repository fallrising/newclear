import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import { createAppointment, isApiError, keys, memberQueries, type AppointmentDraft, type Me } from "@cms/api/public";
import { Alert, AlertDescription, Button, Card, CardContent, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@cms/ui";
import { api } from "../api";
import { copy, type CopyKey } from "../copy";
import { currentLocalMinute, localDateTimeToIso, MEMBER_LIST_SIZE, PET_TYPE } from "../member";
import { useMemberUnauthorized } from "../member-session";
import { Crumbs } from "../parts";
import { usePageMeta } from "../seo";
import { FrontTitle } from "../shell";
import { DetailSkeleton, EmptyPublished, ErrorPublic } from "../states";
type Field = "pet" | "preferredAt" | "reason";
type FieldErrors = Partial<Record<Field, CopyKey>>;
const fieldCopy: Record<Field, CopyKey> = { pet: "member.form.pet.invalid", preferredAt: "member.form.preferredAt.invalid", reason: "member.form.reason.invalid" };
export function AppointmentNew() {
  const pets = useQuery(memberQueries.list(api, PET_TYPE, { size: MEMBER_LIST_SIZE }));
  const [pet, setPet] = useState<string | null>(null);
  const [preferredAt, setPreferredAt] = useState("");
  const [reason, setReason] = useState("");
  const [fields, setFields] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<CopyKey | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const inFlight = useRef(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({ mutationFn: (payload: AppointmentDraft) => createAppointment(api, payload) });
  const unauthorized = useMemberUnauthorized(pets.error, mutation.error);
  const min = currentLocalMinute();
  const selectedPet = pet ?? pets.data?.items[0]?.id ?? "";
  usePageMeta({ title: copy["member.appointment.new"], index: false });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const next: FieldErrors = {};
    const iso = localDateTimeToIso(preferredAt);
    if (!pets.data?.items.some((entry) => entry.id === selectedPet)) next.pet = fieldCopy.pet;
    if (!iso || new Date(iso).getTime() <= Date.now()) next.preferredAt = fieldCopy.preferredAt;
    if (!reason.trim() || reason.trim().length > 1000) next.reason = fieldCopy.reason;
    setFields(next);
    setAlert(null);
    if (Object.keys(next).length) return;
    const principalId = queryClient.getQueryData<Me>(keys.auth.me())?.principal.id;
    const active = () => mounted.current && queryClient.getQueryData<Me>(keys.auth.me())?.principal.id === principalId;
    inFlight.current = true;
    try {
      const created = await mutation.mutateAsync({ pet: selectedPet, preferredAt: iso!, reason: reason.trim() });
      if (!active()) return;
      queryClient.setQueryData(keys.member.detail(created.id), created);
      await queryClient.invalidateQueries({ queryKey: ["member", "entries", "appointment_request"] });
      if (!active()) return;
      navigate("/clinic/appointments/" + created.id, { replace: true });
    } catch (error) {
      if (!active()) return;
      if (isApiError(error) && error.status === 401) return;
      if (isApiError(error) && error.status === 422) {
        const mapped: FieldErrors = {};
        let unknown = error.fields.length === 0;
        for (const item of error.fields) {
          const field = item.field.replace(/^payload\./, "");
          if (item.field === "payload." + field && (field === "pet" || field === "preferredAt" || field === "reason")) mapped[field] = fieldCopy[field]; else unknown = true;
        }
        setFields(mapped);
        if (unknown) setAlert("form.error.invalid");
      } else if (isApiError(error)) {
        setAlert(error.code === "RATE_LIMITED" ? "member.error.rateLimited" : error.code === "FORBIDDEN" ? "member.error.forbiddenCreate" : error.code === "CSRF_FAILED" ? "form.error.session" : error.code === "CONTENT_TYPE_NOT_FOUND" ? "member.error.unavailable" : error.status === 400 ? "form.error.invalid" : "form.error.failed");
      } else setAlert("form.error.failed");
    } finally { inFlight.current = false; }
  }
  if (unauthorized || pets.isPending) return <DetailSkeleton />;
  if (pets.isError) return <ErrorPublic level="page" onRetry={pets.refetch} />;
  return <>
    <Crumbs items={[{ label: copy["site.clinic"], to: "/clinic" }, { label: copy["member.home.title"], to: "/clinic/me" }, { label: copy["member.appointment.new"] }]} />
    <FrontTitle>
      {copy["member.appointment.new"]}
    </FrontTitle>
    {pets.data.items.length === 0 ? <EmptyPublished title={copy["empty.appointments.noPet"]} description={copy["empty.me.pets.body"]} /> : <Card>
      <CardContent>
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6 pt-6" data-testid="appointment-form">
          {alert ? <Alert variant="destructive" data-testid="appointment-form-alert">
            <AlertDescription>
              {copy[alert]}
            </AlertDescription>
          </Alert> : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-pet">
              {copy["member.form.pet"]}
            </Label>
            <Select value={selectedPet} onValueChange={setPet} required>
              <SelectTrigger id="appointment-pet" data-testid="appointment-pet" className="w-full" aria-invalid={!!fields.pet} aria-describedby={fields.pet ? "pet-error" : undefined}>
                <SelectValue placeholder={copy["member.form.pet"]} />
              </SelectTrigger>
              <SelectContent data-scheme="clinic-warm" className="bg-page text-foreground">
                {pets.data.items.map((entry) => <SelectItem key={entry.id} value={entry.id}>
                  {entry.title || copy["member.pet.species.other"]}
                </SelectItem>)}
              </SelectContent>
            </Select>
            {fields.pet ? <p id="pet-error" role="alert">
              {copy[fields.pet]}
            </p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-preferred-at">
              {copy["member.form.preferredAt"]}
            </Label>
            <Input id="appointment-preferred-at" data-testid="appointment-preferred-at" type="datetime-local" value={preferredAt} min={min} onChange={(event) => setPreferredAt(event.target.value)} required aria-invalid={!!fields.preferredAt} aria-describedby={fields.preferredAt ? "time-error" : undefined} />
            {fields.preferredAt ? <p id="time-error" role="alert">
              {copy[fields.preferredAt]}
            </p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-reason">
              {copy["member.form.reason"]}
            </Label>
            <Textarea id="appointment-reason" data-testid="appointment-reason" value={reason} onChange={(event) => setReason(event.target.value)} required aria-invalid={!!fields.reason} aria-describedby={fields.reason ? "reason-error" : undefined} />
            {fields.reason ? <p id="reason-error" role="alert">
              {copy[fields.reason]}
            </p> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="outline" asChild>
              <Link data-testid="appointment-cancel" to="/clinic/me">
                {copy["member.form.cancel"]}
              </Link>
            </Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="appointment-submit">
              {copy[mutation.isPending ? "member.form.submitting" : "member.form.submit"]}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    }
  </>;
}
