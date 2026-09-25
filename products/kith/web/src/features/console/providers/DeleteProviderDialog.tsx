import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import { useDeleteProvider } from "../../../api/providers";
import { errorCopyKey } from "../../../api/errors";
import { useT } from "../../../copy";
import { Button } from "../../../ui/Button";
import { Dialog } from "../../../ui/Dialog";

export function DeleteProviderDialog(props: {
  id: string;
  name: string;
  agentCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const remove = useDeleteProvider();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("console.providers.deleteTitle", { name: props.name })} data-testid="provider-delete-dialog">
      {props.agentCount > 0 ? (
        <p data-testid="provider-delete-in-use" className="text-sm text-warn">
          {t("console.providers.deleteInUse", { n: props.agentCount })}
        </p>
      ) : (
        <p className="text-sm text-ink-2">{t("console.providers.deleteHelp")}</p>
      )}
      {remove.isError && <p role="alert" className="text-sm text-danger">{t(errorCopyKey(remove.error))}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" data-testid="provider-delete-cancel" onClick={() => props.onOpenChange(false)}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          data-testid="provider-delete-confirm"
          disabled={remove.isPending}
          onClick={() => {
            void remove.mutateAsync({ id: props.id, force: props.agentCount > 0 }).then(() => {
              void navigate("/console/providers");
            });
          }}
        >
          {t("console.providers.delete")}
        </Button>
      </div>
    </Dialog>
  );
}
