import { screen, within } from "@testing-library/react";
import { db, setScenario } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import { publicEntry, recordRequests, renderRoute } from "./test-utils";

describe("clinic site (F-S4)", () => {
  it("F-S4 the clinic home shows the profile (name, intro, address, telephone, hours) and the vets", async () => {
    renderRoute("/clinic");
    const profile = await screen.findByTestId("clinic-profile");
    expect(within(profile).getByRole("heading", { level: 1, name: "Cedar Pet Clinic" })).toBeInTheDocument();
    expect(within(profile).getByText("A small neighbourhood clinic for well animals.")).toBeInTheDocument();
    expect(within(profile).getByText("14 Cedar Street")).toBeInTheDocument();
    expect(within(profile).getByRole("link", { name: "6085553000" })).toHaveAttribute("href", "tel:6085553000");
    expect(within(profile).getByText("Mon–Fri 08:00–17:00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "我們的獸醫" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "全部獸醫" })).toHaveAttribute("href", "/clinic/vets");
    expect(document.title).toBe("診所");
  });

  it("C-13 S-04 markdown fields render Markdown; raw HTML and images are not rendered", async () => {
    publicEntry("clinic_profile", "home").payload.intro =
      'A small neighbourhood clinic for **well** animals. <script>alert(1)</script> ![x](https://evil.example/x.png) [call](javascript:alert(1))';
    renderRoute("/clinic");
    const profile = await screen.findByTestId("clinic-profile");
    expect(within(profile).getByText("well").tagName).toBe("STRONG");
    expect(profile.querySelector("script")).toBeNull();
    expect(profile.querySelector("img")).toBeNull();
    expect(within(profile).getByText("call").getAttribute("href")).toBe("");
  });

  it("surface-front §4.2 no clinic profile: the fallback title shows and the vets still render", async () => {
    db.publicEntries = db.publicEntries.filter((e) => e.contentType !== "clinic_profile");
    renderRoute("/clinic");
    expect(await screen.findByRole("heading", { level: 1, name: "寵物診所" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("vet-card")).toHaveLength(2);
  });

  it("AC-04 /clinic/vets lists only published vets; the draft's slug is not in the DOM", async () => {
    renderRoute("/clinic/vets");
    const cards = await screen.findAllByTestId("vet-card");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual(["/clinic/vets/helen-leary", "/clinic/vets/james-carter"]);
    expect(document.body.innerHTML).not.toContain("linda-douglas");
    expect(screen.queryByText("Linda Douglas")).not.toBeInTheDocument();
  });

  it("F-S4 a vet card shows the specialty as a badge (view-pack label, 01 Q-17) and the bio excerpt", async () => {
    renderRoute("/clinic/vets");
    const james = (await screen.findAllByTestId("vet-card")).find((card) => card.getAttribute("href") === "/clinic/vets/james-carter")!;
    expect(within(james).getByRole("heading", { level: 2, name: "James Carter" })).toBeInTheDocument();
    expect(within(james).getByTestId("badge-specialty")).toHaveTextContent("放射科");
    expect(within(james).getByText("Imaging.")).toBeInTheDocument();
  });

  it("W3-FM14 an enum value without a label shows no badge", async () => {
    publicEntry("vet", "james-carter").payload.specialty = "acupuncture";
    renderRoute("/clinic/vets");
    const james = (await screen.findAllByTestId("vet-card")).find((card) => card.getAttribute("href") === "/clinic/vets/james-carter")!;
    expect(within(james).queryByTestId("badge-specialty")).not.toBeInTheDocument();
    expect(james).not.toHaveTextContent("acupuncture");
  });

  it("F-S4 the vet page shows the name, the specialty and the bio as Markdown", async () => {
    publicEntry("vet", "helen-leary").payload.bio = "Teeth, *gently*.";
    renderRoute("/clinic/vets/helen-leary");
    expect(await screen.findByRole("heading", { level: 1, name: "Helen Leary" })).toBeInTheDocument();
    expect(screen.getByTestId("badge-specialty")).toHaveTextContent("牙科");
    expect(screen.getByText("gently").tagName).toBe("EM");
    expect(screen.getByRole("navigation", { name: "頁面路徑" })).toHaveTextContent("診所");
  });

  it("AC-04 AC-07 a draft vet's page renders NotFoundPublic", async () => {
    renderRoute("/clinic/vets/linda-douglas");
    expect(await screen.findByTestId("not-found-public")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到診所首頁" })).toHaveAttribute("href", "/clinic");
  });

  it("W3-FM07 a list that fails shows ErrorPublic in place; the page keeps its heading", async () => {
    setScenario("error500");
    renderRoute("/clinic/vets");
    expect(await screen.findByTestId("error-public")).toHaveTextContent("暫時無法載入");
    expect(screen.getByRole("heading", { level: 1, name: "我們的獸醫" })).toBeInTheDocument();
    expect(screen.queryByTestId("empty-published")).not.toBeInTheDocument();
  });

  it("surface-front §7.2 the vet list asks for 12 per page sorted by name, and never for drafts", async () => {
    const requests = recordRequests();
    renderRoute("/clinic/vets");
    await screen.findAllByTestId("vet-card");
    const list = requests.find((r) => r.path === "/api/v1/public/content-types/vet/entries");
    expect(list?.search).toBe("?size=12&sort=title");
  });
});
