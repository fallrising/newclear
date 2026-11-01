import { useEffect } from "react";
import type { WorkField } from "@cms/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import type { FormValues } from "./form";
import { FieldWidget } from "./widgets";

const field = (type: string) => ({ key: "value", type, required: false, order: 0, label: "Field", group: null, helpText: "Helpful context", placeholder: null, enumValues: ["one", "two"], enumLabels: {}, refTarget: null, listable: false, filterable: false, visibility: "back" }) as WorkField;
function Form({ type, value, error = false, onSave = () => {} }: { type: string; value: unknown; error?: boolean; onSave?: (values: FormValues) => void }) {
  const form = useForm<FormValues>({ defaultValues: { value } });
  useEffect(() => { if (error) form.setError("value", { type: "server", message: "WRONG_TYPE" }); }, [error, form]);
  return <form onSubmit={form.handleSubmit(onSave)}><FieldWidget field={field(type)} control={form.control} /><button type="submit">Save</button></form>;
}

describe("editable and accessible widget states", () => {
  it.each(["NaN", "Infinity", "12oops", "9007199254740993"])("retains invalid integer draft %s so it can be corrected", (raw) => {
    render(<Form type="int" value="1" />);
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: raw } });
    expect(screen.getByLabelText("Field")).toHaveValue(raw);
  });

  it("clears an optional boolean with null without submitting", async () => {
    const onSave = vi.fn();
    render(<Form type="boolean" value={true} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "清除Field" }));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(onSave.mock.calls[0][0]).toEqual({ value: null }));
  });

  it.each(["string", "int", "markdown", "boolean", "enum", "datetime"])("associates %s errors and help with its control", (type) => {
    render(<Form type={type} value={type === "boolean" ? false : ""} error />);
    const control = type === "enum" ? screen.getByRole("radiogroup") : screen.getByLabelText("Field");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", "field-value-help field-value-error");
    expect(screen.getByTestId("field-value-help")).toHaveTextContent("Helpful context");
  });
});
