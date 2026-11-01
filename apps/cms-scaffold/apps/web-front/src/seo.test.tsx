import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { summarize } from "./seo";
import { canonical, meta, publicEntry, renderRoute } from "./test-utils";

const COVER_WEB = "http://localhost:8080/api/v1/public/media/20000000-0000-4000-8000-000000000001/file/web";

describe("SEO (surface-front §4.6)", () => {
  it("AC-17 a published album: title, description, og tags, index, and a canonical URL without ?preview=", async () => {
    renderRoute("/album/albums/coast-light-2026?preview=abc");
    expect(await screen.findByRole("heading", { level: 1, name: "Coast Light 2026" })).toBeInTheDocument();
    expect(document.title).toBe("Coast Light 2026 · 相簿");
    await waitFor(() => expect(meta("robots")).toBe("index,follow"));
    expect(canonical()).toBe(`${window.location.origin}/album/albums/coast-light-2026`);
    expect(meta("description")).toBe("Sea and concrete.");
    expect(meta("og:title")).toBe("Coast Light 2026");
    expect(meta("og:description")).toBe("Sea and concrete.");
    expect(meta("og:image")).toBe(COVER_WEB);
  });

  it("AC-17 moving from a content page to a 404 replaces robots with noindex and removes canonical and og:image", async () => {
    const { router } = renderRoute("/album/albums/coast-light-2026");
    await waitFor(() => expect(meta("og:image")).toBe(COVER_WEB));
    await router.navigate("/album/albums/secret");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    await waitFor(() => expect(meta("robots")).toBe("noindex,nofollow"));
    expect(canonical()).toBeNull();
    expect(meta("og:image")).toBeNull();
    expect(meta("description")).toBeNull();
  });

  it("surface-front §4.6 no summary: the description tags are omitted", async () => {
    renderRoute("/projects/cms-scaffold/milestones/m1-specs");
    expect(await screen.findByRole("heading", { level: 1, name: "M1 Specs" })).toBeInTheDocument();
    await waitFor(() => expect(meta("robots")).toBe("index,follow"));
    expect(meta("description")).toBeNull();
    expect(meta("og:description")).toBeNull();
  });

  it("surface-front §4.6 a site home uses the site name and description", async () => {
    renderRoute("/clinic");
    expect(await screen.findByTestId("clinic-profile")).toBeInTheDocument();
    await waitFor(() => expect(meta("og:title")).toBe("診所"));
    expect(meta("description")).toBe("診所介紹與獸醫團隊。");
    expect(canonical()).toBe(`${window.location.origin}/clinic`);
  });

  it("surface-front §4.6 the description is the plain text of the Markdown summary", async () => {
    publicEntry("project", "cms-scaffold").payload.summary = "Reusable **CMS** kernel, see [docs](https://example.org).";
    renderRoute("/projects/cms-scaffold");
    await waitFor(() => expect(meta("description")).toBe("Reusable CMS kernel, see docs."));
  });

  it("summarize strips Markdown, collapses spaces and cuts at 160 characters", () => {
    expect(summarize("# Title\n\n**bold** _it_ `code` > quote")).toBe("Title bold it code quote");
    expect(summarize("x".repeat(200))).toBe(`${"x".repeat(159)}…`);
    expect(summarize("   ")).toBeNull();
    expect(summarize(42)).toBeNull();
  });

  it("surface-front §4.6 public/robots.txt disallows login, logout and the member area", () => {
    const robots = readFileSync(join(__dirname, "..", "public", "robots.txt"), "utf8");
    for (const line of ["Allow: /album", "Allow: /clinic", "Allow: /projects", "Disallow: /login", "Disallow: /logout", "Disallow: /clinic/me", "Disallow: /clinic/appointments"]) {
      expect(robots.split("\n")).toContain(line);
    }
  });
});
