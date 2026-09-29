import { createBrowserRouter, Navigate } from "react-router-dom";
import { MemberLayout } from "@/layouts/MemberLayout";
import { BoardLayout } from "@/layouts/BoardLayout";
import { RootRedirect } from "@/app/RootRedirect";
import {
  MemberInventoryPage,
  MemberItemDetailPage,
  MemberCartPage,
  MemberRequestDetailPage,
  MemberLoanDetailPage,
  MemberNotificationsPage,
  MemberProfilePage,
  MemberActivityPage,
} from "@/pages/member";
import {
  BoardDashboardPage,
  BoardBorrowedPage,
  BoardPeoplePage,
  BoardMorePage,
  BoardInventoryPage,
  BoardItemDetailPage,
  BoardRequestsPage,
  BoardRequestDetailPage,
  BoardLoanDetailPage,
  BoardProjectsPage,
  BoardProjectDetailPage,
  BoardUserDetailPage,
  BoardAuditsPage,
  BoardAuditDetailPage,
  BoardIncidentsPage,
  BoardIncidentDetailPage,
  BoardInsightsPage,
  BoardExportsPage,
  BoardProfilePage,
  BoardNotificationsPage,
  BoardAuditLogPage,
} from "@/pages/board";
import { NotFoundPage } from "@/pages/system/NotFoundPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/auth/login",
    element: <Navigate to="/app?auth=login" replace />,
  },
  {
    path: "/auth/board-login",
    async lazy() {
      const { BoardLoginPage } = await import("@/pages/auth/BoardLoginPage");
      return { Component: BoardLoginPage };
    },
  },
  {
    path: "/auth/register",
    element: <Navigate to="/app?auth=login" replace />,
  },
  {
    path: "/auth/forgot-password",
    element: <Navigate to="/app?auth=login" replace />,
  },
  {
    path: "/app",
    element: <MemberLayout />,
    children: [
      { index: true, element: <MemberInventoryPage /> },
      { path: "inventory", element: <MemberInventoryPage /> },
      { path: "inventory/:itemId", element: <MemberItemDetailPage /> },
      { path: "cart", element: <MemberCartPage /> },
      { path: "activity", element: <MemberActivityPage /> },
      { path: "requests", element: <Navigate to="/app/activity" replace /> },
      { path: "requests/:requestId", element: <MemberRequestDetailPage /> },
      { path: "loans", element: <Navigate to="/app/activity" replace /> },
      { path: "loans/:loanId", element: <MemberLoanDetailPage /> },
      { path: "favorites", element: <Navigate to="/app/inventory" replace /> },
      { path: "notifications", element: <MemberNotificationsPage /> },
      { path: "profile", element: <MemberProfilePage /> },
    ],
  },
  {
    path: "/board",
    element: <BoardLayout />,
    children: [
      { index: true, element: <BoardDashboardPage /> },
      { path: "dashboard", element: <BoardDashboardPage /> },
      { path: "requests", element: <BoardRequestsPage /> },
      { path: "requests/:requestId", element: <BoardRequestDetailPage /> },
      { path: "borrowed", element: <BoardBorrowedPage /> },
      { path: "borrowed/:loanId", element: <BoardLoanDetailPage /> },
      { path: "loans", element: <Navigate to="/board/borrowed" replace /> },
      { path: "loans/:loanId", element: <BoardLoanDetailPage /> },
      { path: "inventory", element: <BoardInventoryPage /> },
      { path: "inventory/:itemId", element: <BoardItemDetailPage /> },
      { path: "people", element: <BoardPeoplePage /> },
      { path: "people/:userId", element: <BoardUserDetailPage /> },
      { path: "more", element: <BoardMorePage /> },
      { path: "projects", element: <BoardProjectsPage /> },
      { path: "projects/:projectId", element: <BoardProjectDetailPage /> },
      { path: "users", element: <Navigate to="/board/people" replace /> },
      { path: "users/:userId", element: <BoardUserDetailPage /> },
      { path: "audits", element: <BoardAuditsPage /> },
      { path: "audits/:auditId", element: <BoardAuditDetailPage /> },
      { path: "incidents", element: <BoardIncidentsPage /> },
      { path: "incidents/:incidentId", element: <BoardIncidentDetailPage /> },
      { path: "insights", element: <BoardInsightsPage /> },
      { path: "exports", element: <BoardExportsPage /> },
      { path: "audit-log", element: <BoardAuditLogPage /> },
      { path: "profile", element: <BoardProfilePage /> },
      { path: "notifications", element: <BoardNotificationsPage /> },
    ],
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);
