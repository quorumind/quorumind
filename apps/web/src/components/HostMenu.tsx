import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type HostLinkKind, type HostNavigation } from "../api.ts";
import {
  BackIcon,
  BuildingIcon,
  CardIcon,
  CheckIcon,
  ChevronsIcon,
  HomeIcon,
  PlusIcon,
  ShieldIcon,
  UserIcon,
  UsersIcon,
} from "./Icons.tsx";

// The host's part of the menu (hosted version), drawn as on the host's own screens: the same menu on both sides.

const initial = (name: string) => Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?";

type Workspaces = NonNullable<HostNavigation["workspaces"]>;

/**
 * The current workspace, and a menu to switch to another one or to create one. A menu button (ARIA menu pattern): the
 * arrow keys move through the items, Enter picks one, Escape closes the menu and gives the focus back to the button.
 * Another workspace has other sessions, decisions and settings: the page loads again in it.
 */
export function WorkspaceSwitch({ workspaces }: { workspaces: Workspaces }) {
  const { t } = useTranslation();
  const menuId = useId();
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const list = menuItems(menu.current);
    const checked = list.find((item) => item.getAttribute("aria-checked") === "true");
    (open === "last" ? list.at(-1) : (checked ?? list[0]))?.focus();
    // A click anywhere else closes the menu, leaving the focus where it went.
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (workspaces.list.length === 0) {
    return (
      <a className="button button-secondary" href={workspaces.createUrl}>
        <PlusIcon />
        {t("host.createWorkspace")}
      </a>
    );
  }
  const current = workspaces.list.find((workspace) => workspace.current) ?? null;
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
      <button
        ref={button}
        type="button"
        className="workspace-button"
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls={open ? menuId : undefined}
        disabled={busy}
        onClick={() => (open ? close(false) : setOpen("first"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(event.key === "ArrowUp" ? "last" : "first");
          }
        }}
      >
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
        <div
          ref={menu}
          id={menuId}
          className="workspace-menu"
          role="menu"
          aria-label={t("host.workspace")}
          tabIndex={-1}
          onKeyDown={onMenuKey}
        >
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

const ICONS: Record<Exclude<HostLinkKind, "debates">, () => ReactNode> = {
  home: HomeIcon,
  billing: CardIcon,
  members: UsersIcon,
  profile: BuildingIcon,
  account: UserIcon,
  staff: ShieldIcon,
};

/** The host's pages, the workspace's and the account's, in a group of their own. */
export function HostLinks({ links }: { links: HostNavigation["links"] }) {
  const { t } = useTranslation();
  const pages = links.filter((link): link is { kind: Exclude<HostLinkKind, "debates">; url: string } => link.kind !== "debates");
  if (pages.length === 0) return null;
  return (
    <div className="nav-group">
      <h2 className="nav-group-label">{t("host.group")}</h2>
      {pages.map((link) => {
        const Icon = ICONS[link.kind];
        return (
          <a key={link.kind} className="nav-link" href={link.url}>
            <Icon />
            {t(`host.${link.kind}`)}
          </a>
        );
      })}
    </div>
  );
}

/** Who is signed in. */
export function HostUser({ user }: { user: HostNavigation["user"] }) {
  return (
    <div className="sidebar-user">
      <span>{user.name || user.email}</span>
      {user.name ? <span className="muted">{user.email}</span> : null}
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
