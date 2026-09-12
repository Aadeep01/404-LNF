import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <p>Website Localization Prototype</p>
      <h1>Workspace ready.</h1>
      <p>Dashboard implementation comes next.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
