import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RetryIcon } from "./Icons.tsx";

// The lists the server pages (the debates, the gallery, the register): the first page comes with the list, a button
// asks for the next one, and the page says what happened — to the eyes, and to a screen reader — and keeps the focus
// where the person is working rather than on a button that has just disappeared.

/** What a list of pages answers: the entries, and the cursor of the page after them (null at the end). */
export interface PageAnswer<T> {
  items: T[];
  next: string | null;
}

/** What the last "Show more" added: how many, from which entry, and a count that tells two such loads apart. */
export interface Loaded {
  from: number;
  added: number;
  total: number;
  seq: number;
}

/** What the button needs to know of a list; the debates of the menu's list and a search's results both give it. */
export interface PagerView {
  next: string | null;
  loadingMore: boolean;
  moreFailed: boolean;
  more: () => void;
  loaded: Loaded | null;
  /** The list is being asked again: the button is for the previous query, so it is marked busy and does nothing. */
  refreshing?: boolean;
}

/** Entries after a page that was loaded again: each appears once, in the order they came. */
export function withoutRepeats<T>(items: T[], identity: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = identity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface PagerState<T> {
  items: T[] | null;
  next: string | null;
  failed: boolean;
  /** What the first page failed with. */
  error: unknown;
  loadingMore: boolean;
  moreFailed: boolean;
  loaded: Loaded | null;
  /** The first page of a new query is on its way; the entries of the previous one stay until it comes. */
  refreshing: boolean;
}

const FIRST: PagerState<never> = {
  items: null,
  next: null,
  failed: false,
  error: null,
  loadingMore: false,
  moreFailed: false,
  loaded: null,
  refreshing: false,
};

/** Counts the loads of every list, so that two lists never give the same number to different loads. */
let loadCount = 0;
export const nextLoad = () => ++loadCount;

/**
 * A list read page by page. `load` gives a page after a cursor (null for the first), or is null while there is nothing
 * to ask (the list is then empty of entries, as before any answer); the list starts again when `load`
 * changes, and only the answer to the latest one is kept. `extra` is what the first page answered besides its entries.
 */
export function usePager<T, E = undefined>(
  load: ((before: string | null) => Promise<PageAnswer<T> & { extra?: E }>) | null,
  identity: (item: T) => string,
): PagerView & { items: T[] | null; failed: boolean; error: unknown; extra: E | undefined; refreshing: boolean; reload: () => void } {
  const [state, setState] = useState<PagerState<T>>(FIRST);
  const [extra, setExtra] = useState<E | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  // A page being asked for, whatever React has rendered yet: a second click in the same tick asks nothing.
  const busy = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` starts the list again on a retry.
  useEffect(() => {
    const request = ++latest.current;
    busy.current = false;
    if (!load) {
      setState(FIRST);
      return;
    }
    // The entries of the previous query stay on screen until the first page of this one comes.
    setState((current) => ({ ...FIRST, items: current.items, next: current.next, refreshing: current.items !== null }));
    load(null).then(
      (page) => {
        if (request !== latest.current) return;
        setState({ ...FIRST, items: page.items, next: page.next });
        setExtra(page.extra);
      },
      (caught: unknown) => {
        if (request === latest.current) setState({ ...FIRST, failed: true, error: caught });
      },
    );
  }, [load, attempt]);

  const { next, loadingMore, items } = state;
  const more = useCallback(() => {
    if (!load || !next || busy.current || state.refreshing || !items) return;
    busy.current = true;
    const request = latest.current;
    setState((current) => ({ ...current, loadingMore: true, moreFailed: false }));
    load(next).then(
      (page) => {
        if (request !== latest.current) return;
        busy.current = false;
        setState((current) => {
          const before = current.items ?? [];
          const merged = withoutRepeats([...before, ...page.items], identity);
          return {
            ...current,
            items: merged,
            next: page.next,
            loadingMore: false,
            loaded: { from: before.length, added: merged.length - before.length, total: merged.length, seq: nextLoad() },
          };
        });
      },
      () => {
        if (request !== latest.current) return;
        busy.current = false;
        setState((current) => ({ ...current, loadingMore: false, moreFailed: true }));
      },
    );
  }, [next, state.refreshing, items, load, identity]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return {
    items: state.items,
    next,
    loadingMore,
    moreFailed: state.moreFailed,
    more,
    loaded: state.loaded,
    failed: state.failed,
    error: state.error,
    refreshing: state.refreshing,
    extra,
    reload,
  };
}

/** A value that follows another after it stopped changing for `ms`: a search is asked once the person paused. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * The button after a paged list, and what goes with it. The button stays in place while the page loads (it is marked
 * busy, not disabled, so the focus is not lost); once the last page is in, the focus goes to the first new entry, since
 * the button is gone; a screen reader hears how many entries came. `list` holds the entries, `entry` finds each of them
 * and `focusable` the link inside. A page that already has a status line saying how many entries it shows (the
 * register's, a search's) passes `announce={false}`: one load is then announced once, by that line. The component is
 * mounted again (a `key`) for each list that shares its place, so a load of another list is never replayed.
 */
export function ShowMore({
  pager,
  list,
  entry = "li",
  focusable = "a",
  announce = true,
}: {
  pager: PagerView;
  list: RefObject<HTMLElement | null>;
  entry?: string;
  focusable?: string;
  announce?: boolean;
}) {
  const { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null);
  const { loaded, next } = pager;
  // What was loaded before this component appeared is not news: only the loads that come after are announced.
  const handled = useRef(loaded?.seq ?? 0);
  const [said, setSaid] = useState<Loaded | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs once per load, not on every render.
  useEffect(() => {
    if (!loaded || loaded.seq === handled.current) return;
    handled.current = loaded.seq;
    setSaid(loaded);
    const active = document.activeElement;
    // Someone who moved on meanwhile keeps their place.
    if (active && active !== document.body && active !== button.current) return;
    if (next) button.current?.focus();
    else {
      const first = list.current?.querySelectorAll<HTMLElement>(entry)[loaded.from];
      (first?.matches(focusable) ? first : first?.querySelector<HTMLElement>(focusable))?.focus();
    }
  }, [loaded]);

  return (
    <div className="show-more">
      {pager.moreFailed ? (
        <p className="notice notice-error" role="alert">
          {t("paging.failed")}
        </p>
      ) : null}
      {next ? (
        <button
          ref={button}
          type="button"
          className="button button-secondary"
          aria-busy={pager.loadingMore || Boolean(pager.refreshing)}
          aria-disabled={pager.loadingMore || Boolean(pager.refreshing)}
          onClick={() => {
            if (!pager.loadingMore && !pager.refreshing) pager.more();
          }}
        >
          {pager.moreFailed ? <RetryIcon /> : null}
          {pager.loadingMore ? t("common.loading") : pager.moreFailed ? t("common.retry") : t("paging.more")}
        </button>
      ) : null}
      {/* Said once per load; the entries themselves are not read out again. */}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {announce && said ? t("paging.loaded", { added: said.added, count: said.total }) : ""}
      </p>
    </div>
  );
}
