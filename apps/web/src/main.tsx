import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ready } from "./i18n.ts";
import { applyStoredTheme } from "./theme.ts";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
applyStoredTheme();
// The first screen is shown in the person's language, not in English for a moment.
void ready.then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
