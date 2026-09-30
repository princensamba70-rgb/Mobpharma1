import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { NetworkProvider } from './context/NetworkContext';
import NativeRuntime from './components/NativeRuntime';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Facturation from './pages/Facturation';
import Ventes from './pages/Ventes';
import Approvisionnements from './pages/Approvisionnements';
import Stock from './pages/Stock';
import Inventaires from './pages/Inventaires';
import RapportJournalier from './pages/RapportJournalier';
import RapportAppro from './pages/RapportAppro';
import Finance from './pages/Finance';
import Medicaments from './pages/Medicaments';
import Catalogue from './pages/Catalogue';
import Fournisseurs from './pages/Fournisseurs';
import Utilisateurs from './pages/Utilisateurs';
import Audit from './pages/Audit';
import Parametres from './pages/Parametres';

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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
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
