import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type GalleryItem } from "./api.ts";
import { GalleryIcon, PlusIcon } from "./components/Icons.tsx";
import { Skeleton } from "./components/Logo.tsx";
import { EmptyState, PageHeading } from "./components/Page.tsx";

/** Debates their owners chose to publish: real reports anyone can read. */
export function Gallery() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api.gallery().then(
      (body) => setItems(body.sessions),
      () => setError(true),
    );
  }, []);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  return (
    <div className="stack-lg">
      <div className="stack">
        <PageHeading title={t("gallery.title")} />
        <p className="lead" style={{ margin: 0 }}>
          {t("gallery.lead")}
        </p>
      </div>
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
      <div className="gallery">
        {items?.map((item) => (
          <a key={item.token} className="card gallery-card" href={`#/shared/${item.token}`}>
            <span className="title">{item.idea}</span>
            {item.summary ? <span className="muted gallery-summary">{item.summary}</span> : null}
            <span className="field-hint">{date.format(new Date(item.updatedAt))}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
