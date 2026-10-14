import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import { CardDataProvider } from "./hooks/useCardData.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <CardDataProvider>
        <App />
      </CardDataProvider>
    </BrowserRouter>
  </React.StrictMode>
);
