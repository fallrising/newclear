import { createContext, useContext, useEffect } from "react";

/** Suffix appended to every page title, for example "CMS 作業台". Provided by AppFrame or the Front site shell. */
export const TitleSuffixContext = createContext<string>("");

/** F-05: sets document.title to "<title> · <suffix>" (suffix omitted when empty). */
export function useDocumentTitle(title: string | null | undefined) {
  const suffix = useContext(TitleSuffixContext);
  useEffect(() => {
    document.title = [title, suffix].filter((part) => part).join(" · ");
  }, [title, suffix]);
}
