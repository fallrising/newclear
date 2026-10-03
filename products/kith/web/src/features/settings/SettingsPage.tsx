import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { meQueryKey } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useChangeOwnPassword, useUpdateMe } from "../../api/me";
import type { Me } from "../../api/types";
import { useT } from "../../copy";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";

export function SettingsPage(props: { me: Me }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const changePassword = useChangeOwnPassword();
  const forced = props.me.must_change_password;
  const [displayName, setDisplayName] = useState(props.me.display_name);
  const [nameError, setNameError] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<"short" | "mismatch" | "wrong" | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (!nameSaved) return;
    const id = window.setTimeout(() => setNameSaved(false), 3000);
    return () => window.clearTimeout(id);
  }, [nameSaved]);

  const saveName = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (trimmed.length < 1 || trimmed.length > 64) {
      setNameError(true);
      setNameSaved(false);
      return;
    }
    setNameError(false);
    updateMe.mutate(
      { display_name: trimmed },
      {
        onSuccess: () => setNameSaved(true),
      },
    );
  };

  const savePassword = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setPasswordSaved(false);
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError("short");
      return;
    }
    if (newPassword !== confirm) {
      setPasswordError("mismatch");
      return;
    }
    setPasswordError(null);
    changePassword.mutate(
      { memberId: props.me.id, old_password: oldPassword, new_password: newPassword },
      {
        onSuccess: () => {
          setOldPassword("");
          setNewPassword("");
          setConfirm("");
          setPasswordSaved(true);
          if (forced) {
            void queryClient.refetchQueries({ queryKey: meQueryKey }).then(() => {
              void navigate("/", { replace: true });
            });
          }
        },
        onError: (err) => {
          if (err instanceof ApiError && err.code === "wrong_password") setPasswordError("wrong");
        },
      },
    );
  };

  return (
    <section data-testid="settings-page" className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <h1 className="text-xl font-semibold text-ink">{t("settings.title")}</h1>
      {forced && (
        <div data-testid="settings-force-banner" role="alert" className="mt-4 rounded-md border border-border bg-surface-2 px-4 py-3 text-sm text-warn">
          {t("settings.force.banner")}
        </div>
      )}
      {!forced && (
        <form data-testid="settings-profile-form" className="mt-6 flex max-w-login flex-col gap-3" onSubmit={saveName}>
          <h2 className="text-md font-medium text-ink">{t("settings.profile.title")}</h2>
          <TextField
            id="settings-display-name"
            data-testid="settings-display-name"
            label={t("settings.displayName.label")}
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={setDisplayName}
            invalid={nameError}
          />
          {nameError && (
            <p role="alert" className="text-sm text-danger">
              {t("settings.displayName.invalid")}
            </p>
          )}
          <Button variant="primary" type="submit" data-testid="settings-display-name-save" disabled={updateMe.isPending}>
            {t("settings.displayName.save")}
          </Button>
          {nameSaved && (
            <p data-testid="settings-display-name-saved" role="status" className="text-sm text-ink-2">
              {t("settings.saved")}
            </p>
          )}
        </form>
      )}
      <form data-testid="settings-password-form" className="mt-8 flex max-w-login flex-col gap-3" onSubmit={savePassword}>
        <h2 className="text-md font-medium text-ink">{t("settings.password.title")}</h2>
        <TextField
          id="settings-old-password"
          data-testid="settings-old-password"
          label={t("settings.password.old")}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={setOldPassword}
          invalid={passwordError === "wrong"}
        />
        {passwordError === "wrong" && (
          <p role="alert" className="text-sm text-danger">
            {t("settings.password.wrongOld")}
          </p>
        )}
        <TextField
          id="settings-new-password"
          data-testid="settings-new-password"
          label={t("settings.password.new")}
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={setNewPassword}
          invalid={passwordError === "short"}
        />
        {passwordError === "short" && (
          <p role="alert" className="text-sm text-danger">
            {t("settings.password.tooShort")}
          </p>
        )}
        <TextField
          id="settings-confirm-password"
          data-testid="settings-confirm-password"
          label={t("settings.password.confirm")}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          invalid={passwordError === "mismatch"}
        />
        {passwordError === "mismatch" && (
          <p role="alert" className="text-sm text-danger">
            {t("settings.password.mismatch")}
          </p>
        )}
        <Button variant="primary" type="submit" data-testid="settings-password-save" disabled={changePassword.isPending}>
          {t("settings.password.save")}
        </Button>
        {passwordSaved && (
          <p data-testid="settings-password-saved" role="status" className="text-sm text-ink-2">
            {t("settings.saved")}
          </p>
        )}
      </form>
    </section>
  );
}
