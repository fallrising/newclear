import { RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useCreateMember } from "../../api/members";
import { ApiError } from "../../api/client";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { generatePassword } from "../../ui/password";
import { TextField } from "../../ui/TextField";

const HANDLE_RE = /^[a-z0-9_]{2,32}$/;

export function CreatePersonDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const create = useCreateMember();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ handle?: CopyKey; displayName?: CopyKey; password?: CopyKey; form?: CopyKey }>({});
  const [created, setCreated] = useState<{ handle: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setHandle("");
      setDisplayName("");
      setPassword("");
      setErrors({});
      setCreated(null);
      setCopied(false);
      return;
    }
    setPassword((current) => current || generatePassword());
  }, [props.open]);

  const close = (): void => props.onOpenChange(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const next: typeof errors = {};
    const trimmedHandle = handle.trim();
    const trimmedName = displayName.trim();
    if (!HANDLE_RE.test(trimmedHandle)) next.handle = "console.people.handleInvalid";
    if (trimmedName.length < 1 || trimmedName.length > 64) next.displayName = "settings.displayName.invalid";
    if (password.length < 12 || password.length > 128) next.password = "console.people.passwordInvalid";
    if (next.handle || next.displayName || next.password) {
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(
      { handle: trimmedHandle, display_name: trimmedName, password },
      {
        onSuccess: () => setCreated({ handle: trimmedHandle, password }),
        onError: (err) => {
          if (err instanceof ApiError && err.code === "handle_taken") setErrors({ handle: "console.people.handleTaken" });
          else setErrors({ form: "error.code.unknown" });
        },
      },
    );
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("console.people.createTitle")}>
      {created ? (
        <div data-testid="person-created" className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">{t("console.people.createdHelp")}</p>
          <code data-testid="person-created-handle">{created.handle}</code>
          <code data-testid="person-created-password">{created.password}</code>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              data-testid="person-created-copy"
              onClick={() => {
                void navigator.clipboard.writeText("handle: " + created.handle + "\npassword: " + created.password).then(() => {
                  setCopied(true);
                });
              }}
            >
              {t("console.people.copy")}
            </Button>
            <Button variant="primary" data-testid="person-created-done" onClick={close}>
              {t("console.people.done")}
            </Button>
          </div>
          {copied && (
            <p data-testid="person-created-copied" role="status" className="text-sm text-ink-2">
              {t("console.people.copied")}
            </p>
          )}
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <TextField
            id="person-create-handle"
            data-testid="person-create-handle"
            label={t("console.people.handle")}
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={setHandle}
            invalid={errors.handle !== undefined}
          />
          {errors.handle && (
            <p role="alert" className="text-sm text-danger">
              {t(errors.handle)}
            </p>
          )}
          <TextField
            id="person-create-display-name"
            data-testid="person-create-display-name"
            label={t("console.people.displayName")}
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={setDisplayName}
            invalid={errors.displayName !== undefined}
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                id="person-create-password"
                data-testid="person-create-password"
                label={t("console.people.initialPassword")}
                type="text"
                autoComplete="off"
                value={password}
                onChange={setPassword}
                invalid={errors.password !== undefined}
              />
            </div>
            <IconButton
              data-testid="person-create-regenerate"
              label={t("console.people.regenerate")}
              icon={RefreshCw}
              onClick={() => setPassword(generatePassword())}
            />
          </div>
          {errors.password && (
            <p role="alert" className="text-sm text-danger">
              {t(errors.password)}
            </p>
          )}
          {errors.form && (
            <p data-testid="person-create-error" role="alert" className="text-sm text-danger">
              {t(errors.form)}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="primary" type="submit" data-testid="person-create-submit" disabled={create.isPending}>
              {t("console.people.submit")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
