import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "@fontsource-variable/inter";
import { App } from "./App";
import "./globals.css";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
