import { createElement, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

export function Page({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) {
  return createElement("div", { className: "mx-auto max-w-5xl px-6 py-8" },
    createElement("header", { className: "mb-8 flex flex-wrap items-end justify-between gap-4" },
      createElement("div", null,
        eyebrow ? createElement("p", { className: "mb-1 text-xs uppercase tracking-[0.2em] text-[var(--muted)]" }, eyebrow) : null,
        createElement("h1", { className: "text-3xl font-semibold" }, title),
      ),
      actions ? createElement("div", { className: "flex gap-2" }, actions) : null,
    ),
    children,
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "danger" }) {
  const { tone = "default", className = "", ...rest } = props;
  const color = tone === "danger" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--line)]";
  return createElement("button", {
    ...rest,
    className: `rounded-lg border bg-[var(--panel)] px-3 py-2 text-sm ${color} ${className}`,
  });
}

export function Input(props: InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> & { multiline?: boolean }) {
  const { multiline, className = "", ...rest } = props;
  const shared = `w-full rounded-lg border border-[var(--line)] bg-[#0c1014] px-3 py-2 text-[var(--text)] ${className}`;
  if (multiline) return createElement("textarea", { ...(rest as object), className: shared + " min-h-32" });
  return createElement("input", { ...(rest as object), className: shared });
}

export function Card({ children }: { children: ReactNode }) {
  return createElement("div", { className: "rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4" }, children);
}

export function Banner({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
  const color = tone === "danger" ? "border-[var(--danger)] text-[var(--danger)]" : "text-[var(--muted)]";
  return createElement("p", { className: `rounded-lg border border-[var(--line)] px-3 py-2 text-sm ${color}` }, children);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return createElement("label", { className: "mb-4 block text-sm" },
    createElement("span", { className: "mb-1 block text-[var(--muted)]" }, label),
    children,
  );
}
