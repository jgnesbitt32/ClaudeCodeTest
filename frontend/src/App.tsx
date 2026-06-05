import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import PatientDetailPage from "./pages/PatientDetailPage";
import PatientsPage from "./pages/PatientsPage";
import RefillsPage from "./pages/RefillsPage";
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
        <Route path="projections" element={<Placeholder title="Projections" />} />
        <Route path="reports" element={<Placeholder title="Reports" />} />
      </Route>
    </Routes>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-64 text-gray-400 text-xl font-medium">
      {title} — coming soon
    </div>
  );
}
