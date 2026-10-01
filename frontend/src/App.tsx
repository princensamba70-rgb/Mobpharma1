import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { NetworkProvider } from './context/NetworkContext';
import NativeRuntime from './components/NativeRuntime';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

// Keep the authentication shell small. The original static imports pulled all
// 18 pages, Recharts and every page dependency into the first JavaScript chunk
// even when the visitor was still on the login screen.
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Facturation = lazy(() => import('./pages/Facturation'));
const Ventes = lazy(() => import('./pages/Ventes'));
const Approvisionnements = lazy(() => import('./pages/Approvisionnements'));
const Stock = lazy(() => import('./pages/Stock'));
const Inventaires = lazy(() => import('./pages/Inventaires'));
const RapportJournalier = lazy(() => import('./pages/RapportJournalier'));
const RapportAppro = lazy(() => import('./pages/RapportAppro'));
const Finance = lazy(() => import('./pages/Finance'));
const Medicaments = lazy(() => import('./pages/Medicaments'));
const Catalogue = lazy(() => import('./pages/Catalogue'));
const Fournisseurs = lazy(() => import('./pages/Fournisseurs'));
const Utilisateurs = lazy(() => import('./pages/Utilisateurs'));
const Audit = lazy(() => import('./pages/Audit'));
const Parametres = lazy(() => import('./pages/Parametres'));
const Synchronisation = lazy(() => import('./pages/Synchronisation'));

function PermRoute({ perm, niveau = 'read', children }: { perm?: string; niveau?: 'full' | 'read'; children: JSX.Element }) {
  const { user, loading, can } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><Spinner className="w-10 h-10" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm, niveau)) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-center p-6">
        <div className="text-6xl">🔒</div>
        <h2 className="text-xl font-bold text-slate-700">Accès refusé</h2>
        <p className="text-sm text-slate-500 max-w-md">
          Votre rôle ({user.roleName}) ne permet pas d'accéder à ce module. Contactez l'administrateur si nécessaire.
        </p>
        <Navigate to="/" replace />
      </div>
    );
  }
  return children;
}

function RouteFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 bg-slate-50 p-6">
      <Spinner className="w-8 h-8" />
      <p className="text-sm text-slate-500 font-medium">Ouverture du module…</p>
    </div>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4 bg-slate-100">
        <Spinner className="w-10 h-10" />
        <p className="text-sm text-slate-400 font-medium">Chargement d'AMI PHARMA…</p>
      </div>
    );
  }
  if (!user) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/synchronisation" element={<Synchronisation />} />
        <Route path="/facturation" element={<PermRoute perm="facturation" niveau="full"><Facturation /></PermRoute>} />
        <Route path="/ventes" element={<PermRoute perm="facturation"><Ventes /></PermRoute>} />
        <Route path="/ventes/:id" element={<PermRoute perm="facturation"><Ventes detail /></PermRoute>} />
        <Route path="/approvisionnements" element={<PermRoute perm="approvisionnement"><Approvisionnements /></PermRoute>} />
        <Route path="/stock" element={<PermRoute perm="stock"><Stock /></PermRoute>} />
        <Route path="/inventaires" element={<PermRoute perm="inventaire"><Inventaires /></PermRoute>} />
        <Route path="/rapport-journalier" element={<PermRoute perm="rapportJournalier"><RapportJournalier /></PermRoute>} />
        <Route path="/rapports/approvisionnement" element={<PermRoute perm="rapports"><RapportAppro /></PermRoute>} />
        <Route path="/finance" element={<PermRoute perm="finance"><Finance /></PermRoute>} />
        <Route path="/medicaments" element={<PermRoute perm="medicaments"><Medicaments /></PermRoute>} />
        <Route path="/catalogue" element={<PermRoute perm="catalogue"><Catalogue /></PermRoute>} />
        <Route path="/fournisseurs" element={<PermRoute perm="fournisseurs"><Fournisseurs /></PermRoute>} />
        <Route path="/utilisateurs" element={<PermRoute perm="utilisateurs" niveau="full"><Utilisateurs /></PermRoute>} />
        <Route path="/audit" element={<PermRoute perm="audit"><Audit /></PermRoute>} />
        <Route path="/parametres" element={<PermRoute perm="parametres" niveau="full"><Parametres /></PermRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <NetworkProvider>
        <AuthProvider>
          <NativeRuntime />
          <Shell />
        </AuthProvider>
      </NetworkProvider>
    </ToastProvider>
  );
}
