import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ReceiptText, Truck, PackageSearch, Boxes,
  CalendarClock, ClipboardList, Wallet, Pill, BookOpenCheck, Users, Settings,
  ScrollText, Bell, Menu, X, LogOut, KeyRound, ChevronLeft, Building2, FileBarChart,
  Home, MoreHorizontal, WifiOff, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useNetwork } from '../context/NetworkContext';
import { api } from '../api/client';
import { Modal, Field } from './ui';

const Logo = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <rect width="100" height="100" rx="22" fill="#0d9488" />
    <rect x="42" y="16" width="16" height="68" rx="5" fill="white" />
    <rect x="16" y="42" width="68" height="16" rx="5" fill="white" />
  </svg>
);

interface MenuItem { to: string; label: string; icon: any; perm?: string; niveau?: 'full' | 'read'; section: string }

const MENU: MenuItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, section: 'Pilotage' },
  { to: '/facturation', label: 'Facturation', icon: ShoppingCart, perm: 'facturation', niveau: 'full', section: 'Opérations' },
  { to: '/ventes', label: 'Ventes', icon: ReceiptText, perm: 'facturation', niveau: 'read', section: 'Opérations' },
  { to: '/approvisionnements', label: 'Approvisionnement', icon: Truck, perm: 'approvisionnement', niveau: 'read', section: 'Opérations' },
  { to: '/stock', label: 'Gestion de stock', icon: Boxes, perm: 'stock', niveau: 'read', section: 'Opérations' },
  { to: '/inventaires', label: 'Inventaire', icon: ClipboardList, perm: 'inventaire', niveau: 'read', section: 'Opérations' },
  { to: '/rapport-journalier', label: 'Rapport journalier', icon: CalendarClock, perm: 'rapportJournalier', niveau: 'read', section: 'Rapports' },
  { to: '/rapports/approvisionnement', label: 'Rapport approvisionnement', icon: FileBarChart, perm: 'rapports', niveau: 'read', section: 'Rapports' },
  { to: '/finance', label: 'Finance', icon: Wallet, perm: 'finance', niveau: 'read', section: 'Rapports' },
  { to: '/medicaments', label: 'Médicaments', icon: Pill, perm: 'medicaments', niveau: 'read', section: 'Référentiels' },
  { to: '/catalogue', label: 'Catalogue des prix', icon: BookOpenCheck, perm: 'catalogue', niveau: 'read', section: 'Référentiels' },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Building2, perm: 'fournisseurs', niveau: 'read', section: 'Référentiels' },
  { to: '/utilisateurs', label: 'Utilisateurs', icon: Users, perm: 'utilisateurs', niveau: 'full', section: 'Administration' },
  { to: '/audit', label: 'Journal d\'audit', icon: ScrollText, perm: 'audit', niveau: 'read', section: 'Administration' },
  { to: '/parametres', label: 'Paramètres', icon: Settings, perm: 'parametres', niveau: 'full', section: 'Administration' },
];

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="hidden md:block text-right leading-tight">
      <p className="text-xs font-semibold text-slate-700 capitalize">
        {now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <p className="text-[11px] text-slate-400 tabular-nums">{now.toLocaleTimeString('fr-FR')}</p>
    </div>
  );
}

function ConnectivityBanner() {
  const { online, staleData } = useNetwork();
  if (online && !staleData) return null;
  return (
    <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium ${online ? 'bg-amber-50 text-amber-800 border-b border-amber-200' : 'bg-slate-800 text-white'}`}>
      {online ? <RefreshCw className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      <span>{online ? 'Connexion revenue — affichage de données mises en cache possible.' : 'Hors connexion — les lectures disponibles proviennent du cache. Les opérations d’écriture sont suspendues.'}</span>
    </div>
  );
}

function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const items = [
    { to: '/', label: 'Accueil', icon: Home },
    { to: '/facturation', label: 'Vendre', icon: ShoppingCart },
    { to: '/stock', label: 'Stock', icon: Boxes },
    { to: '/ventes', label: 'Ventes', icon: ReceiptText },
  ];
  return (
    <nav className="mobile-bottom-nav lg:hidden" aria-label="Navigation principale">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `mobile-nav-item ${isActive ? 'mobile-nav-item-active' : ''}`}>
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
      <button type="button" className="mobile-nav-item" onClick={onMore}>
        <MoreHorizontal className="h-5 w-5" />
        <span>Plus</span>
      </button>
    </nav>
  );
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  const load = () => api.get('/api/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const dyn = data?.dynamiques || [];
  const unreadPersisted = (data?.persistees || []).filter((n: any) => !n.lu).length;
  const count = dyn.length + unreadPersisted;
  const niveauColor: Record<string, string> = {
    danger: 'bg-red-100 text-red-600 border-red-200',
    warning: 'bg-amber-100 text-amber-600 border-amber-200',
    success: 'bg-emerald-100 text-emerald-600 border-emerald-200',
    info: 'bg-sky-100 text-sky-600 border-sky-200',
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="relative p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors" title="Notifications">
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 animate-pulse">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50 animate-scale-in">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
            <p className="font-bold text-sm text-slate-700">Centre de notifications</p>
            {data?.persistees?.length > 0 && (
              <button className="text-xs text-brand-600 hover:underline" onClick={() => api.post('/api/notifications/lu-tout').then(load)}>Tout marquer lu</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
            {dyn.length === 0 && unreadPersisted === 0 && (data?.persistees || []).length === 0 && (
              <p className="text-sm text-slate-400 text-center py-8">Aucune notification 🎉</p>
            )}
            {dyn.map((n: any) => (
              <div key={n.id} className={`px-4 py-3 border-l-4 ${niveauColor[n.niveau] || niveauColor.info}`}>
                <p className="text-xs font-bold">{n.titre}</p>
                <p className="text-xs mt-0.5 opacity-90">{n.message}</p>
              </div>
            ))}
            {(data?.persistees || []).map((n: any) => (
              <div key={n.id} className={`px-4 py-3 ${n.lu ? 'opacity-50' : ''}`}
                onClick={() => { api.post(`/api/notifications/${n.id}/lu`).then(load); }}>
                <p className="text-xs font-bold text-slate-700">{n.titre}</p>
                <p className="text-xs text-slate-500 mt-0.5">{n.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const changePwd = async () => {
    if (pwd.newPassword !== pwd.confirm) return toast('error', 'La confirmation ne correspond pas');
    try {
      await api.post('/api/auth/change-password', { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword });
      toast('success', 'Mot de passe modifié avec succès');
      setPwdOpen(false); setPwd({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (e: any) { toast('error', e.message); }
  };

  const roleBadge: Record<string, string> = {
    ADMIN: 'bg-brand-100 text-brand-700', FINANCE: 'bg-violet-100 text-violet-700', ASSISTANT: 'bg-sky-100 text-sky-700',
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
          {user?.prenom?.[0]}{user?.nom?.[0]}
        </div>
        <div className="hidden lg:block text-left leading-tight">
          <p className="text-xs font-bold text-slate-700">{user?.prenom} {user?.nom}</p>
          <p className={`text-[10px] font-semibold rounded px-1 w-fit ${roleBadge[user?.roleId || '']}`}>{user?.roleName}</p>
        </div>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-50 animate-scale-in">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
            <p className="text-sm font-bold text-slate-700">{user?.prenom} {user?.nom}</p>
            <p className="text-xs text-slate-400">@{user?.username}</p>
          </div>
          <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => { setOpen(false); setPwdOpen(true); }}>
            <KeyRound className="w-4 h-4" /> Changer le mot de passe
          </button>
          <button className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 border-t border-slate-100"
            onClick={logout}>
            <LogOut className="w-4 h-4" /> Déconnexion
          </button>
        </div>
      )}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="Changer le mot de passe">
        <div className="space-y-4">
          <Field label="Mot de passe actuel" required>
            <input type="password" className="input" value={pwd.currentPassword}
              onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} />
          </Field>
          <Field label="Nouveau mot de passe" required>
            <input type="password" className="input" value={pwd.newPassword}
              onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} placeholder="Min. 8 caractères, 1 majuscule, 1 chiffre" />
          </Field>
          <Field label="Confirmer" required>
            <input type="password" className="input" value={pwd.confirm}
              onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setPwdOpen(false)}>Annuler</button>
            <button className="btn-primary" onClick={changePwd}>Enregistrer</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function Layout() {
  const { user, can } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const items = MENU.filter((m) => !m.perm || can(m.perm, m.niveau));
  const sections = [...new Set(items.map((i) => i.section))];

  const sidebar = (
    <div className={`flex flex-col h-full bg-gradient-to-b from-slate-900 via-slate-900 to-brand-950 text-white transition-all duration-300 ${collapsed ? 'w-[68px]' : 'w-64'}`}>
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 ${collapsed ? 'justify-center px-2' : ''}`}>
        <Logo size={collapsed ? 30 : 34} />
        {!collapsed && (
          <div className="leading-tight overflow-hidden">
            <p className="font-extrabold tracking-wide text-[15px]">AMI PHARMA</p>
            <p className="text-[9px] text-brand-300 uppercase tracking-widest">Pharmacy Management</p>
          </div>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {sections.map((sec) => (
          <div key={sec}>
            {!collapsed && <p className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{sec}</p>}
            <div className="space-y-0.5">
              {items.filter((i) => i.section === sec).map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} title={collapsed ? i.label : ''}
                  className={({ isActive }) => (isActive ? 'sidebar-link-active' : 'sidebar-link') + (collapsed ? ' justify-center px-2' : '')}>
                  <i.icon className="w-[18px] h-[18px] shrink-0" />
                  {!collapsed && <span className="truncate">{i.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="p-2.5 border-t border-white/10 hidden lg:block">
        <button onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 text-xs text-slate-400 hover:text-white py-2 rounded-lg hover:bg-white/10 transition-colors">
          <ChevronLeft className={`w-4 h-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          {!collapsed && 'Réduire'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar desktop */}
      <aside className="hidden lg:block shrink-0">{sidebar}</aside>
      {/* Sidebar mobile */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 animate-slide-in">{sidebar}</div>
          <button className="absolute top-4 left-[270px] text-white bg-slate-800/80 rounded-full p-2" onClick={() => setMobileOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6 shrink-0 z-40">
          <button className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">AMI PHARMA — Système intégré de gestion de pharmacie</p>
          </div>
          <Clock />
          <div className="w-px h-8 bg-slate-200 hidden md:block" />
          <NotificationsBell />
          <ProfileMenu collapsed={collapsed} />
        </header>
        <ConnectivityBanner />
        <main className="mobile-main flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
        <MobileBottomNav onMore={() => setMobileOpen(true)} />
      </div>
    </div>
  );
}
