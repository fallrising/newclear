import { render, screen } from "@testing-library/react";
import type { WorkField } from "@cms/api";
import { describe, expect, it } from "vitest";
import { FieldCell } from "./cell";

const field = (type: string): WorkField => ({ key: "field", type, required: false, order: 0, label: null, group: null, helpText: null, placeholder: null, enumValues: ["ready"], enumLabels: { ready: "Ready to go" }, refTarget: null, listable: false, filterable: false, visibility: "back" });

describe("list cell display", () => {
  it.each<[string, unknown]>([["boolean", false], ["geo", { lat: 25 }], ["string", null]])("leaves %s empty when the registry has no display value", (type, value) => {
    const { container } = render(<FieldCell field={field(type)} value={value} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the enum label and shows affirmative booleans", () => {
    render(<><FieldCell field={field("enum")} value="ready" /><FieldCell field={field("boolean")} value={true} /></>);
    expect(screen.getByText("Ready to go")).toBeInTheDocument();
    expect(screen.getByText("是")).toBeInTheDocument();
  });
});
