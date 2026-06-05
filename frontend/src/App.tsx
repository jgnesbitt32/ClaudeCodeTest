import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import PatientDetailPage from "./pages/PatientDetailPage";
import PatientsPage from "./pages/PatientsPage";
import ProjectionsPage from "./pages/ProjectionsPage";
import RefillsPage from "./pages/RefillsPage";
import ReportsPage from "./pages/ReportsPage";
import ShippingPage from "./pages/ShippingPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/refills" replace />} />
        <Route path="refills" element={<RefillsPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="shipping" element={<ShippingPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:ptsn" element={<PatientDetailPage />} />
        <Route path="projections" element={<ProjectionsPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
    </Routes>
  );
}
