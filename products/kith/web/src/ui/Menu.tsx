import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

const CONTENT = "z-50 min-w-48 rounded-md border border-border bg-surface p-1 shadow-popover";
const ITEM =
  "flex h-10 cursor-default items-center gap-2 rounded-sm px-3 text-md text-ink outline-none data-[highlighted]:bg-surface-2";

function Content(props: ComponentProps<typeof DropdownMenu.Content>): ReactElement {
  const { className, ...rest } = props;
  return <DropdownMenu.Content className={className ? CONTENT + " " + className : CONTENT} {...rest} />;
}

function Item(props: ComponentProps<typeof DropdownMenu.Item>): ReactElement {
  const { className, ...rest } = props;
  return <DropdownMenu.Item className={className ? ITEM + " " + className : ITEM} {...rest} />;
}

function RadioItem(props: ComponentProps<typeof DropdownMenu.RadioItem>): ReactElement {
  const { className, children, ...rest } = props;
  return (
    <DropdownMenu.RadioItem className={className ? ITEM + " " + className : ITEM} {...rest}>
      <DropdownMenu.ItemIndicator className="inline-flex">
        <Check size={16} aria-hidden />
      </DropdownMenu.ItemIndicator>
      {children}
    </DropdownMenu.RadioItem>
  );
}

function Label(props: ComponentProps<typeof DropdownMenu.Label>): ReactElement {
  const { className, ...rest } = props;
  const cls = "px-3 pt-2 pb-1 text-xs font-medium text-ink-3" + (className ? " " + className : "");
  return <DropdownMenu.Label className={cls} {...rest} />;
}

function Separator(props: ComponentProps<typeof DropdownMenu.Separator>): ReactElement {
  const { className, ...rest } = props;
  const cls = "my-1 h-px bg-border" + (className ? " " + className : "");
  return <DropdownMenu.Separator className={cls} {...rest} />;
}

export const Menu = {
  Root: DropdownMenu.Root,
  Trigger: DropdownMenu.Trigger,
  Portal: DropdownMenu.Portal,
  Content,
  Item,
  RadioGroup: DropdownMenu.RadioGroup,
  RadioItem,
  Separator,
  Label,
};
