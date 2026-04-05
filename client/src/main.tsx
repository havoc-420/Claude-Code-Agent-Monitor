import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Intercept any 401+loginRequired response globally and redirect to /login.
const _fetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await _fetch(...args);
  if (res.status === 401) {
    const clone = res.clone();
    const body = await clone.json().catch(() => ({}));
    if (body?.loginRequired) {
      window.location.href = "/login";
    }
  }
  return res;
};

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
