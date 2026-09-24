import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { useLogout } from "../api/auth";
import type { Me } from "../api/types";
import { useLocale, useT, type Locale } from "../copy";
import { Avatar } from "../ui/Avatar";
import { displayName } from "../ui/displayName";
import { Menu } from "../ui/Menu";
import { readTheme, saveTheme, type ThemePref } from "./theme";

export function UserMenu(props: { me: Me }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const logout = useLogout();
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const name = displayName(props.me);
  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="user-menu"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 h-10 hover:bg-surface text-left"
      >
        <Avatar size={28} id={props.me.id} name={name} kind="human" />
        <span data-testid="app-shell-user" className="truncate text-sm text-ink-2">
          {name}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content side="top" align="start">
          <Menu.Item data-testid="user-menu-settings" onSelect={() => void navigate("/settings")}>
            {t("user.menu.settings")}
          </Menu.Item>
          <Menu.Separator />
          <Menu.Label>{t("user.menu.theme")}</Menu.Label>
          <Menu.RadioGroup
            value={theme}
            onValueChange={(value) => {
              const next = value as ThemePref;
              saveTheme(next);
              setTheme(next);
            }}
          >
            <Menu.RadioItem value="system" data-testid="user-menu-theme-system">
              {t("user.menu.themeSystem")}
            </Menu.RadioItem>
            <Menu.RadioItem value="light" data-testid="user-menu-theme-light">
              {t("user.menu.themeLight")}
            </Menu.RadioItem>
            <Menu.RadioItem value="dark" data-testid="user-menu-theme-dark">
              {t("user.menu.themeDark")}
            </Menu.RadioItem>
          </Menu.RadioGroup>
          <Menu.Separator />
          <Menu.Label>{t("user.menu.language")}</Menu.Label>
          <Menu.RadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
            <Menu.RadioItem value="zh-TW" data-testid="user-menu-lang-zh-TW">
              繁體中文
            </Menu.RadioItem>
            <Menu.RadioItem value="en" data-testid="user-menu-lang-en">
              English
            </Menu.RadioItem>
          </Menu.RadioGroup>
          <Menu.Separator />
          <Menu.Item data-testid="app-shell-logout" onSelect={() => logout.mutate()}>
            {t("app.shell.logout")}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
