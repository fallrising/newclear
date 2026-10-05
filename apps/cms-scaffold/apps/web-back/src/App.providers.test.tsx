import { render, screen, waitFor } from "@testing-library/react";
import { db, setUser } from "@cms/mocks";
import { describe, expect, it } from "vitest";
import App from "./App";

// Exercise the production App providers. The shared renderRoute helper adds a global
// FieldsProvider and would hide a missing provider on these route boundaries.
function openApp(path: string, user = "seed-operator-album") {
  setUser(user);
  window.history.replaceState(null, "", path);
  render(<App />);
}

describe("actual App field-service coverage", () => {
  it("media library renders every thumbnail through the deferred provider", async () => {
    openApp("/media");
    // A cold Vitest process also transforms the lazy route modules; this is a provider assertion, not an SLO.
    expect(await screen.findAllByTestId("media-card", undefined, { timeout: 5000 })).toHaveLength(8);
    expect(screen.queryByText("FieldsProvider is missing")).not.toBeInTheDocument();
  });

  it("media detail renders its file image", async () => {
    const media = db.media.find((asset) => asset.title === "Softbox")!;
    openApp(`/media/${media.id}`);
    expect(await screen.findByTestId("media-image")).toHaveAttribute("src", expect.stringContaining(`/media/${media.id}/file/web`));
  });

  it("composer renders its ordered photo thumbnails", async () => {
    const album = db.workEntries.find((entry) => entry.slug === "coast-light-2026")!;
    openApp(`/views/album.composer?album=${album.id}`);
    expect(await screen.findAllByTestId("composer-photo")).toHaveLength(6);
    await waitFor(() => expect(screen.getAllByTestId("composer-photo")[0]).toHaveTextContent("Harbour wall"));
  });

  it("schedule resolves the pet and vet reference names", async () => {
    const visit = db.workEntries.find((entry) => entry.title === "Leo rabies shot")!;
    const date = new Date(String(visit.payload.scheduledAt));
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    openApp(`/views/clinic.schedule?date=${day}`, "seed-operator-clinic");
    expect(await screen.findAllByTestId("schedule-visit")).not.toHaveLength(0);
    const row = (await screen.findByText("Leo rabies shot")).closest("a")!;
    await waitFor(() => expect(row).toHaveTextContent("寵物Leo"));
    expect(row).toHaveTextContent("獸醫James Carter");
    expect(screen.queryByText("FieldsProvider is missing")).not.toBeInTheDocument();
  });

  it("entry editor keeps its field media picker", async () => {
    const album = db.workEntries.find((entry) => entry.slug === "private-studio")!;
    openApp(`/entries/album/${album.id}`);
    expect(await screen.findByTestId("field-cover-pick")).toBeInTheDocument();
    expect(screen.getByLabelText(/^標題/)).toHaveValue("Studio (unpublished)");
  });
});
