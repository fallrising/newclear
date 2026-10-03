import { RefreshCw } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useResetPassword } from "../../api/members";
import type { AdminMember } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { IconButton } from "../../ui/IconButton";
import { generatePassword } from "../../ui/password";
import { TextField } from "../../ui/TextField";

export function ResetPasswordDialog(props: { member: AdminMember | null; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!props.member) {
      setPassword("");
      setDone(null);
      setCopied(false);
      setInvalid(false);
      return;
    }
    setPassword(generatePassword());
    setDone(null);
    setCopied(false);
    setInvalid(false);
  }, [props.member]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!props.member) return;
    if (password.length < 12 || password.length > 128) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const member = props.member;
    reset.mutate(
      { memberId: member.id, password },
      { onSuccess: () => setDone(password) },
    );
  };

  return (
    <Dialog
      open={props.member !== null}
      onOpenChange={props.onOpenChange}
      title={t("console.people.resetTitle", { name: props.member?.display_name ?? "" })}
    >
      {done ? (
        <div data-testid="reset-password-result" className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">{t("console.people.createdHelp")}</p>
          <code>{done}</code>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              data-testid="reset-password-copy"
              onClick={() => {
                if (!props.member) return;
                void navigator.clipboard.writeText("handle: " + props.member.handle + "\npassword: " + done).then(() => setCopied(true));
              }}
            >
              {t("console.people.copy")}
            </Button>
            <Button variant="primary" data-testid="reset-password-done" onClick={() => props.onOpenChange(false)}>
              {t("console.people.done")}
            </Button>
          </div>
          {copied && (
            <p data-testid="reset-password-copied" role="status" className="text-sm text-ink-2">
              {t("console.people.copied")}
            </p>
          )}
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                id="reset-password-input"
                data-testid="reset-password-input"
                label={t("console.people.initialPassword")}
                type="text"
                autoComplete="off"
                value={password}
                onChange={setPassword}
                invalid={invalid}
              />
            </div>
            <IconButton
              data-testid="reset-password-regenerate"
              label={t("console.people.regenerate")}
              icon={RefreshCw}
              onClick={() => setPassword(generatePassword())}
            />
          </div>
          <div className="flex justify-end">
            <Button variant="primary" type="submit" data-testid="reset-password-submit" disabled={reset.isPending}>
              {t("console.people.reset")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
