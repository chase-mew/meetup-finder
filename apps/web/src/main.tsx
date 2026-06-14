import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { installGlobalErrorReporting } from "./reporting";
// Fraunces (optical-size axis) is the display face for the brand and headlines.
// Self-hosted via fontsource so there are no third-party requests or layout shift.
import "@fontsource-variable/fraunces/opsz.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";

installGlobalErrorReporting();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
