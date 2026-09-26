// @cms/ui — shadcn components, tokens and the Polaris-style patterns (01 §4.2, §6).
export { cn } from "./lib/utils";
export { uiCopy, type UiCopyKey } from "./copy";

export * from "./components/ui/alert";
export * from "./components/ui/badge";
export * from "./components/ui/button";
export * from "./components/ui/card";
export * from "./components/ui/dropdown-menu";
export * from "./components/ui/input";
export * from "./components/ui/label";
export * from "./components/ui/separator";
export * from "./components/ui/sheet";
export * from "./components/ui/skeleton";
export * from "./components/ui/textarea";

export { AppFrame, type AppFrameProps, type NavItem, type NavSection } from "./patterns/app-frame";
export { EmptyState, type EmptyStateProps } from "./patterns/empty-state";
export { PageHeader, type PageAction, type PageHeaderProps } from "./patterns/page-header";
export { DefaultSkeleton, ErrorState, QueryBoundary, type QueryBoundaryProps, type QueryLike } from "./patterns/query-boundary";
export { TitleSuffixContext, useDocumentTitle } from "./patterns/document-title";
