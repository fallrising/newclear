import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useCreateRoom } from "../../api/rooms";
import { ApiError } from "../../api/client";
import { errorCopyKey } from "../../api/errors";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { TextField } from "../../ui/TextField";
import { SLUG_RE, slugify } from "./slugify";

export function CreateRoomDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateRoom();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<{ name?: CopyKey; slug?: CopyKey; form?: CopyKey }>({});

  useEffect(() => {
    if (!props.open) return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setErrors({});
  }, [props.open]);

  const onName = (value: string): void => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const next: { name?: CopyKey; slug?: CopyKey; form?: CopyKey } = {};
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 80) next.name = "rooms.create.nameInvalid";
    if (!SLUG_RE.test(slug)) next.slug = "rooms.create.slugInvalid";
    if (next.name || next.slug) {
      setErrors(next);
      return;
    }
    create.mutate(
      { slug, name: trimmed },
      {
        onSuccess: () => {
          props.onOpenChange(false);
          void navigate("/r/" + slug);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "handle_taken") setErrors({ slug: "rooms.create.slugTaken" });
          else setErrors({ form: errorCopyKey(err) });
        },
      },
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("rooms.create.title")} data-testid="room-create-dialog">
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <TextField
          id="room-create-name"
          data-testid="room-create-name"
          label={t("rooms.create.name")}
          type="text"
          autoComplete="off"
          value={name}
          onChange={onName}
          invalid={errors.name !== undefined}
        />
        {errors.name && (
          <p data-testid="room-create-name-error" role="alert" className="text-sm text-danger">
            {t(errors.name)}
          </p>
        )}
        <TextField
          id="room-create-slug"
          data-testid="room-create-slug"
          label={t("rooms.create.slug")}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={slug}
          onChange={(value) => {
            setSlugTouched(true);
            setSlug(value);
          }}
          invalid={errors.slug !== undefined}
        />
        <p className="text-sm text-ink-3">{t("rooms.create.slugHelp", { slug })}</p>
        {errors.slug && (
          <p data-testid="room-create-slug-error" role="alert" className="text-sm text-danger">
            {t(errors.slug)}
          </p>
        )}
        {errors.form && (
          <p data-testid="room-create-error" role="alert" className="text-sm text-danger">
            {t(errors.form)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" data-testid="room-create-cancel" onClick={() => props.onOpenChange(false)}>
            {t("rooms.create.cancel")}
          </Button>
          <Button variant="primary" type="submit" data-testid="room-create-submit" disabled={create.isPending}>
            {t("rooms.create.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
