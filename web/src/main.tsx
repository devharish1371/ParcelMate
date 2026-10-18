import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(() => {
      // The app still works online when a browser blocks service workers.
    });
  });
}
