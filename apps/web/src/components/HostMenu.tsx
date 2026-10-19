import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HostLinkKind, type HostNavigation } from "../api.ts";
import {
  BackIcon,
  BuildingIcon,
  CardIcon,
  CheckIcon,
  ChevronsIcon,
  ChevronUpIcon,
  HomeIcon,
  PlusIcon,
  ShieldIcon,
  SignOutIcon,
  UserIcon,
  UsersIcon,
} from "./Icons.tsx";

// The host's part of the menu (hosted version), drawn as on the host's own screens: the same menu on both sides.

const initial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";

type Workspaces = NonNullable<HostNavigation["workspaces"]>;

/**
 * A menu button (ARIA menu pattern): the button opens its menu on the first item (on the last with the up arrow),
 * the arrow keys, Home and End move through the items, Enter picks one, Escape closes the menu and gives the focus
 * back to the button, Tab leaves it. A click anywhere else closes it, leaving the focus where it went.
 */
function useMenuButton() {
  const id = useId();
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menu.current);
    const checked = list.find((item) => item.getAttribute("aria-checked") === "true");
    (open === "last" ? list.at(-1) : (checked ?? list[0]))?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = menuItems(menu.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      // Only the menu closes: the phone menu around it stays open.
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return {
    open: Boolean(open),
    close,
    button: {
      ref: button,
      "aria-haspopup": "menu" as const,
      "aria-expanded": Boolean(open),
      "aria-controls": open ? id : undefined,
      onClick: () => (open ? close(false) : setOpen("first")),
      onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(event.key === "ArrowUp" ? "last" : "first");
        }
      },
    },
    menu: { ref: menu, id, tabIndex: -1, onKeyDown: onMenuKey },
  };
}

/** The host's pages of the workspace worked in, which its menu opens; the others are the person's, under their card. */
const WORKSPACE_PAGES: ReadonlySet<HostLinkKind> = new Set(["home", "billing", "members", "profile"]);

/**
 * Where the host's pages go: the workspace's in the workspace's menu, the person's in the person's. Without a
 * workspace to show (a host without any, or a person in none yet), the person's menu keeps them all.
 */
function placeLinks(navigation: HostNavigation) {
  if (!navigation.workspaces?.list.length) return { workspace: [], account: navigation.links };
  return {
    workspace: navigation.links.filter((link) => WORKSPACE_PAGES.has(link.kind)),
    account: navigation.links.filter((link) => !WORKSPACE_PAGES.has(link.kind)),
  };
}

const ICONS: Record<HostLinkKind, () => ReactNode> = {
  home: HomeIcon,
  billing: CardIcon,
  members: UsersIcon,
  profile: BuildingIcon,
  account: UserIcon,
  staff: ShieldIcon,
};

/**
 * The current workspace, as a menu button whose menu is the workspace's: the workspace on top, the person's
 * workspaces to switch to another one, the workspace's pages, then the way to create one. Another workspace has
 * other sessions, decisions and settings: the page loads again in it.
 */
export function WorkspaceSwitch({ navigation }: { navigation: HostNavigation }) {
  const { t } = useTranslation();
  const { open, close, button, menu } = useMenuButton();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const { workspaces } = navigation;

  if (!workspaces) return null;
  if (workspaces.list.length === 0) {
    return (
      <a className="button button-secondary" href={workspaces.createUrl}>
        <PlusIcon />
        {t("host.createWorkspace")}
      </a>
    );
  }
  const current = workspaces.list.find((workspace) => workspace.current) ?? null;
  const pages = placeLinks(navigation).workspace;

  const pick = (workspace: Workspaces["list"][number]) => {
    close(true);
    if (workspace.current) return;
    setBusy(true);
    setFailed(false);
    api.switchWorkspace(workspace.switchUrl).then(
      () => {
        // A session belongs to the workspace it was started in: the other one opens on its home.
        if (window.location.hash.startsWith("#/s/")) window.location.hash = "#/";
        window.location.reload();
      },
      () => {
        setBusy(false);
        setFailed(true);
      },
    );
  };

  return (
    <div className="workspace-switch">
      <button {...button} type="button" className="workspace-button" disabled={busy}>
        <span className="workspace-avatar" aria-hidden="true">
          {initial(current?.name ?? "")}
        </span>
        <span className="workspace-text">
          <span className="visually-hidden">{t("host.workspace")}: </span>
          <span className="workspace-name">{current?.name ?? t("host.workspace")}</span>
          {current ? <span className="workspace-role">{t(`host.roles.${current.role}`)}</span> : null}
        </span>
        <ChevronsIcon />
      </button>
      {open ? (
        <div {...menu} role="menu" className="workspace-menu" aria-label={t("host.workspace")}>
          {/* The workspace worked in, over its button: the checked line says it to a screen reader. */}
          <div className="workspace-menu-head" aria-hidden="true" onClick={() => close(true)}>
            <span className="workspace-avatar">{initial(current?.name ?? "")}</span>
            <span className="workspace-text">
              <span className="workspace-name">{current?.name ?? t("host.workspace")}</span>
              {current ? <span className="workspace-role">{t(`host.roles.${current.role}`)}</span> : null}
            </span>
            <ChevronsIcon />
          </div>
          {/* A long list scrolls on its own, the workspace's pages staying in sight. */}
          <div className="workspace-list" role="none">
            {workspaces.list.map((workspace) => (
              <button
                key={workspace.switchUrl}
                type="button"
                role="menuitemradio"
                aria-checked={workspace.current}
                tabIndex={-1}
                className="workspace-item"
                onClick={() => pick(workspace)}
              >
                <span className="workspace-avatar" aria-hidden="true">
                  {initial(workspace.name)}
                </span>
                <span className="workspace-text">
                  <span className="workspace-name">{workspace.name}</span>
                  <span className="workspace-role">{t(`host.roles.${workspace.role}`)}</span>
                </span>
                <span className="workspace-check">{workspace.current ? <CheckIcon /> : null}</span>
              </button>
            ))}
          </div>
          {pages.length > 0 ? (
            <>
              <hr className="workspace-separator" />
              {pages.map((link) => {
                const Icon = ICONS[link.kind];
                return (
                  <a
                    key={link.kind}
                    role="menuitem"
                    tabIndex={-1}
                    className="workspace-item workspace-page"
                    href={link.url}
                    onClick={() => close(false)}
                  >
                    <Icon />
                    {t(`host.${link.kind}`)}
                  </a>
                );
              })}
            </>
          ) : null}
          <hr className="workspace-separator" />
          <a role="menuitem" tabIndex={-1} className="workspace-item workspace-create" href={workspaces.createUrl}>
            <PlusIcon />
            {t("host.createWorkspace")}
          </a>
        </div>
      ) : null}
      {failed ? (
        <p className="notice notice-error" role="alert">
          {t("errors.generic")}
        </p>
      ) : null}
    </div>
  );
}

const menuItems = (menu: HTMLElement | null) => [
  ...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []),
];

/**
 * The person signed in, at the bottom of the menu: a card that opens, above it, the person's pages (the account, and
 * the back-office for staff) and the way to sign out when the host gives one, as a menu button.
 */
export function AccountMenu({ navigation }: { navigation: HostNavigation }) {
  const { t } = useTranslation();
  const { open, close, button, menu } = useMenuButton();
  const [busy, setBusy] = useState(false);
  const { user, signOut } = navigation;
  const links = placeLinks(navigation).account;
  const leave = async () => {
    if (!signOut) return;
    close(false);
    setBusy(true);
    // Whatever the answer, the host's page decides what comes next: signed out, or asked to sign in again.
    await fetch(signOut.url, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    window.location.assign(signOut.next);
  };
  const name = user.name || user.email;
  return (
    <div className="account-switch">
      <button {...button} type="button" className="account-button" disabled={busy}>
        <span className="account-avatar" aria-hidden="true">
          {initial(name)}
        </span>
        <span className="account-text">
          <span className="visually-hidden">{t("host.account")}: </span>
          <span className="account-name">{name}</span>
          {user.name ? <span className="account-email">{user.email}</span> : null}
        </span>
        <span className="account-chevron" aria-hidden="true">
          <ChevronUpIcon />
        </span>
      </button>
      {open ? (
        <div {...menu} role="menu" className="account-menu" aria-label={t("host.account")}>
          {links.map((link) => {
            const Icon = ICONS[link.kind];
            return (
              <a key={link.kind} role="menuitem" tabIndex={-1} className="account-item" href={link.url} onClick={() => close(false)}>
                <Icon />
                {t(`host.${link.kind}`)}
              </a>
            );
          })}
          {signOut ? (
            <>
              {links.length > 0 ? <hr className="account-separator" /> : null}
              <button type="button" role="menuitem" tabIndex={-1} className="account-item account-sign-out" onClick={() => void leave()}>
                <SignOutIcon />
                {t("host.signOut")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The way back to the host's website, named by its host name without "www.". */
export function SiteLink({ url }: { url: string }) {
  const { t } = useTranslation();
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.host.replace(/^www\./, "");
  } catch {
    return null;
  }
  return (
    <a className="site-link" href={url} aria-label={t("host.backToSite", { host })}>
      <BackIcon />
      {host}
    </a>
  );
}
