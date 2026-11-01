import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@cms/api/public";
import { TitleSuffixContext, useDocumentTitle } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { usePageMeta } from "../seo";

/** /logout (surface-front §4.2): ends the session, then goes to "/". A failed or anonymous logout goes to "/" too. */
function LogoutBody() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useDocumentTitle(copy["logout.title"]);
  usePageMeta({ title: copy["logout.title"], index: false });
  useEffect(() => {
    let active = true;
    void api.auth
      .logout()
      .catch(() => undefined)
      .finally(async () => {
        if (!active) return;
        await queryClient.cancelQueries({ queryKey: ["member"] });
        queryClient.removeQueries({ queryKey: ["member"] });
        queryClient.setQueryData(keys.auth.me(), null);
        queryClient.setQueryData(keys.auth.expired(), false);
        navigate("/", { replace: true });
      });
    return () => {
      active = false;
    };
  }, [navigate, queryClient]);
  return (
    <main id="main" className="mx-auto max-w-[1200px] px-4 py-12">
      <h1 className="font-display text-front-title" role="status">
        {copy["logout.title"]}
      </h1>
    </main>
  );
}

export function LogoutPage() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector" className="min-h-screen bg-page text-foreground text-front-body">
        <LogoutBody />
      </div>
    </TitleSuffixContext.Provider>
  );
}
