import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { api, type GalleryItem } from "./api.ts";
import { GalleryIcon, PlusIcon } from "./components/Icons.tsx";
import { Skeleton } from "./components/Logo.tsx";
import { EmptyState, PageHead } from "./components/Page.tsx";
import { ShowMore, usePager } from "./components/ShowMore.tsx";

const loadPage = (before: string | null) => api.gallery(before).then((body) => ({ items: body.sessions, next: body.next ?? null }));
const tokenOf = (item: GalleryItem) => item.token;

/** Debates their owners chose to publish: real reports anyone can read. */
export function Gallery() {
  const { t, i18n } = useTranslation();
  const pager = usePager(loadPage, tokenOf);
  const { items } = pager;
  const error = pager.failed;
  const grid = useRef<HTMLDivElement>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return (
    <div className="stack-lg">
      <PageHead title={t("gallery.title")} lead={t("gallery.lead")} />
      {error ? <p className="notice notice-error">{t("error.request")}</p> : null}
      {items === null && !error ? (
        <div className="gallery">
          <Skeleton lines={3} card />
          <Skeleton lines={3} card />
          <Skeleton lines={3} card />
        </div>
      ) : null}
      {items?.length === 0 ? (
        <EmptyState
          icon={<GalleryIcon />}
          action={
            <a className="button button-secondary" href="#/">
              <PlusIcon />
              {t("nav.newSession")}
            </a>
          }
        >
          {t("gallery.empty")}
        </EmptyState>
      ) : null}
      <div className="gallery" ref={grid}>
        {items?.map((item) => (
          <a key={item.token} className="card gallery-card" href={`#/shared/${item.token}`}>
            <span className="title">{item.idea}</span>
            {item.summary ? <span className="muted gallery-summary">{item.summary}</span> : null}
            <span className="field-hint">{date.format(new Date(item.updatedAt))}</span>
          </a>
        ))}
      </div>
      {items && items.length > 0 ? <ShowMore pager={pager} list={grid} entry=".gallery-card" focusable=".gallery-card" /> : null}
    </div>
  );
}
