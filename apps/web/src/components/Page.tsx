import { type ReactNode, useEffect, useRef } from "react";

// What tells a person, and their screen reader, that the page changed: the title of the tab, and the focus on the new
// page's heading after a navigation inside the app.

const APP_NAME = "Quorumind";

let navigated = false;

/** Called on each navigation inside the app: the next page heading to appear takes the focus. */
export function markNavigation() {
  navigated = true;
}

/** The title of the tab: the page, then the app. */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title === undefined || title === null) return;
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}

/** The main heading of a page: names the tab, and takes the focus when the person just navigated to the page. */
export function PageHeading({ title, className = "display", children }: { title: string; className?: string; children?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  usePageTitle(title);
  useEffect(() => {
    if (!navigated) return;
    navigated = false;
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} className={className} tabIndex={-1}>
      {children ?? title}
    </h1>
  );
}
