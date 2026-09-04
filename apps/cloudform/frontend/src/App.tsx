import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { TemplatesListPage } from '@/features/templates/TemplatesListPage';
import { CreateTemplatePage } from '@/features/templates/CreateTemplatePage';
import { DesignerPage } from '@/features/templates/DesignerPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/templates" replace />} />
        <Route path="/templates" element={<TemplatesListPage />} />
        <Route path="/templates/new" element={<CreateTemplatePage />} />
        <Route path="/templates/:id/design" element={<DesignerPage />} />
      </Route>
    </Routes>
  );
}
