import { Fragment } from "react";
import { Link } from "react-router";
import { Badge, Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@cms/ui";
import { copy, type CopyKey } from "./copy";
import type { ImageSource } from "./media";

export interface PublicImageProps {
  image: ImageSource;
  alt: string;
  /** "lazy" for grids and cards; "eager" for the main image of a detail page. */
  loading: "lazy" | "eager";
  className?: string;
  testId?: string;
}

/** C-14: every public image carries width and height (no layout shift) and an alt text chosen by altOf(). */
export function PublicImage({ image, alt, loading, className, testId }: PublicImageProps) {
  return (
    <img
      src={image.src}
      width={image.width}
      height={image.height}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className}
      data-testid={testId}
    />
  );
}

export interface Crumb {
  label: string;
  /** Omitted on the last crumb (the current page). */
  to?: string;
}

/** Breadcrumb above detail and list pages (01 §7.1 F-S2). */
export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb aria-label={copy["breadcrumb.label"]} className="mb-4">
      <BreadcrumbList className="text-subdued">
        {items.map((item, i) => (
          <Fragment key={`${i}-${item.label}`}>
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {item.to ? (
                <BreadcrumbLink asChild>
                  <Link to={item.to}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Display name of a public enum value. The public contract has no enumLabels (01 Q-17), so each view pack keeps
 * its labels in copy.ts as `enum.<type>.<field>.<value>`. Unknown values have no label.
 */
export function enumLabel(type: string, field: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = `enum.${type}.${field}.${value}`;
  return key in copy ? copy[key as CopyKey] : null;
}

/** An enum value as a Badge; renders nothing for a missing or unknown value. */
export function EnumBadge({ type, field, value, className }: { type: string; field: string; value: unknown; className?: string }) {
  const label = enumLabel(type, field, value);
  if (!label) return null;
  return (
    <Badge variant="secondary" className={className} data-testid={`badge-${field}`}>
      {label}
    </Badge>
  );
}
