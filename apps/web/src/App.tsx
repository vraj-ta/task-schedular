import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext.js';
import { AppLayout } from './layout/AppLayout.js';
import { AdminsPage } from './pages/AdminsPage.js';
import { ArtifactsPage } from './pages/ArtifactsPage.js';
import { CreateJobPage } from './pages/CreateJobPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { JobDetailPage } from './pages/JobDetailPage.js';
import { JobsPage } from './pages/JobsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { PlatformsPage } from './pages/PlatformsPage.js';
import { SchedulesPage } from './pages/SchedulesPage.js';
import { WorkersPage } from './pages/WorkersPage.js';

export const App = () => {
  const { session } = useAuth();

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/new" element={<CreateJobPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/jobs/:id/artifacts" element={<ArtifactsPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/platforms" element={<PlatformsPage />} />
        <Route path="/workers" element={<WorkersPage />} />
        <Route path="/admins" element={<AdminsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
};
