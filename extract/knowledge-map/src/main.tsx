import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./demo/App";
import "./demo/demo.css";
import "./knowledge-map/knowledge-map.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
