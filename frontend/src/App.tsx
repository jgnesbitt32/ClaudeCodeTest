import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import RefillsPage from "./pages/RefillsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/refills" replace />} />
        <Route path="refills" element={<RefillsPage />} />
        <Route path="dashboard" element={<Placeholder title="Dashboard" />} />
        <Route path="shipping" element={<Placeholder title="Shipping" />} />
        <Route path="patients" element={<Placeholder title="Patients" />} />
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
