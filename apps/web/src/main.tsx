import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import "./index.css";
import { ChatPage } from "./routes/Chat";
import { FoodPage } from "./routes/Food";
import { PlanPage } from "./routes/Plan";
import { PlanWizardPage } from "./routes/PlanWizard";
import { SettingsPage } from "./routes/Settings";
import { TodayPage } from "./routes/Today";
import { TrendsPage } from "./routes/Trends";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <TodayPage /> },
      { path: "plan", element: <PlanPage /> },
      { path: "plan/new", element: <PlanWizardPage /> },
      { path: "food", element: <FoodPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "trends", element: <TrendsPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
