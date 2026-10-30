import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { LedgerStore } from "./io/platform";
import "./style.css";
const store = new LedgerStore();
await store.load();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App store={store} />
  </React.StrictMode>,
);
