import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Wallet, Boxes, Pill, ShoppingCart, AlertTriangle, CircleSlash, CalendarClock, Truck,
  TrendingUp, TrendingDown, PackagePlus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, getCachedApiResponse } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { StatCard } from '../components/StatCard';
import { Loading, Badge, Tabs } from '../components/ui';
import { fmtMoney, fmtNum, todayISO } from '../lib/format';

const PERIODS = [
  { id: 'today', label: "Aujourd'hui" },
  { id: 'week', label: '7 derniers jours' },
  { id: 'month', label: '30 derniers jours' },
  { id: 'custom', label: 'Période personnalisée' },
];

const DashboardCharts = lazy(() => import('../components/DashboardCharts'));

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const [custom, setCustom] = useState({ from: todayISO(), to: todayISO() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const qs = useMemo(() => {
    if (period === 'custom') return `?from=${custom.from}&to=${custom.to}`;
    return `?period=${period}`;
  }, [period, custom]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr('');
    const cached = getCachedApiResponse(`/api/dashboard${qs}`);
    if (cached && typeof cached === 'object') setData(cached);
    api.get(`/api/dashboard${qs}`)
      .then((next) => { if (active) setData(next); })
      .catch((e) => { if (active) setErr(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [qs]);

  if (!data && loading) return <Loading label="Chargement du tableau de bord…" />;
  if (!data && err) {
    return (
      <div className="card p-8 text-center space-y-3">
        <p className="text-red-600">{err}</p>
        <button className="btn-secondary" onClick={() => { setErr(''); setLoading(true); api.get(`/api/dashboard${qs}`).then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false)); }}>
          Réessayer
        </button>
      </div>
    );
  }
  if (!data) return null;

  const c = data.cartes;
  const isFinance = user?.roleId === 'FINANCE';
  const series = data.series.map((s: any) => ({ ...s, date: s.date.slice(5).split('-').reverse().join('/') }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* En-tête */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">
            Bonjour, {user?.prenom} <span className="inline-block animate-pulse">👋</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isFinance ? 'Voici la situation financière de la pharmacie.' : "Voici l'état actuel de votre pharmacie."}
          </p>
          {(loading || err) && (
            <p className={`text-xs mt-1 ${err ? 'text-amber-700' : 'text-slate-400'}`} aria-live="polite">
              {err ? `Actualisation impossible : ${err}` : 'Actualisation en cours…'}
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Tabs tabs={PERIODS} active={period} onChange={setPeriod} />
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" className="input w-auto" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              <span className="text-slate-400">→</span>
              <input type="date" className="input w-auto" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      {/* Cartes statistiques */}
      {isFinance ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
          <StatCard icon={<Wallet className="w-5 h-5" />} label="Chiffre d'affaires" value={fmtMoney(c.chiffreAffaires)} sub={`Jour : ${fmtMoney(c.chiffreAffairesJour)}`} accent="teal" />
          <StatCard icon={<Truck className="w-5 h-5" />} label="Dépenses approvisionnement" value={fmtMoney(c.depensesApprovisionnement)} sub={`${c.nbApprovisionnements} commande(s)`} accent="violet" />
          <StatCard icon={<Boxes className="w-5 h-5" />} label="Valeur du stock" value={fmtMoney(c.valeurStock)} sub={`Prix vente : ${fmtMoney(c.valeurStockVente)}`} accent="blue" />
          <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Marge brute" value={fmtMoney(c.margeBrute)} accent="green" />
          <StatCard icon={<Wallet className="w-5 h-5" />} label="Paiements reçus" value={fmtMoney(c.paiementsRecus)} accent="slate" />
          <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Résultat" value={fmtMoney(c.resultat)} sub={`Dépenses : ${fmtMoney(c.depenses)}`} accent={c.resultat >= 0 ? 'green' : 'red'} />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 sm:gap-4">
          <StatCard icon={<Wallet className="w-5 h-5" />} label="💰 Chiffre d'affaires" value={fmtMoney(c.chiffreAffaires)} sub={`Aujourd'hui : ${fmtMoney(c.chiffreAffairesJour)}`} accent="teal" onClick={() => navigate('/rapport-journalier')} />
          <StatCard icon={<Boxes className="w-5 h-5" />} label="📦 Valeur du stock" value={fmtMoney(c.valeurStock)} sub={`Vente : ${fmtMoney(c.valeurStockVente)}`} accent="blue" onClick={() => navigate('/stock')} />
          <StatCard icon={<Pill className="w-5 h-5" />} label="💊 Médicaments" value={fmtNum(c.nbMedicaments)} sub="référencés" accent="violet" onClick={() => navigate('/medicaments')} />
          <StatCard icon={<ShoppingCart className="w-5 h-5" />} label="🛒 Ventes" value={fmtNum(c.nbVentes)} sub={`${c.nbVentesJour} aujourd'hui`} accent="green" onClick={() => navigate('/ventes')} />
          <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="⚠️ Stock faible" value={fmtNum(c.stockFaible)} sub="à surveiller" accent="amber" onClick={() => navigate('/stock?statut=FAIBLE')} />
          <StatCard icon={<CircleSlash className="w-5 h-5" />} label="🔴 Ruptures" value={fmtNum(c.epuises)} sub="stock épuisé" accent="red" onClick={() => navigate('/stock?statut=EPUISE')} />
          <StatCard icon={<CalendarClock className="w-5 h-5" />} label="⏳ Expirations proches" value={fmtNum(c.expirationProche)} sub={c.expires ? `${c.expires} expiré(s)` : '≤ 30 jours'} accent="orange" onClick={() => navigate('/stock?tab=expiration')} />
          <StatCard icon={<Truck className="w-5 h-5" />} label="📥 Approvisionnements" value={fmtNum(c.nbApprovisionnements)} sub={fmtMoney(c.depensesApprovisionnement)} accent="slate" onClick={() => navigate('/approvisionnements')} />
        </div>
      )}

      {/* Charts are loaded after the cards so a slow Recharts chunk cannot
          delay the first useful dashboard content. */}
      <Suspense fallback={<div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6" aria-label="Chargement des graphiques">
        <div className="card h-72 animate-pulse bg-slate-100" />
        <div className="card h-72 animate-pulse bg-slate-100" />
      </div>}>
        <DashboardCharts data={data} series={series} />
      </Suspense>

      {/* Tops produits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
        <TopList title="🏆 Produits les plus vendus" items={data.topVendus} keyLabel="designation" accent="text-emerald-600" />
        <TopList title="📉 Produits les moins vendus" items={data.flopVendus} keyLabel="designation" accent="text-slate-500" />
        <TopList title="📥 Produits les plus achetés" items={data.topAchete} keyLabel="designation" accent="text-violet-600" />
        <TopList title="🛒 Produits les moins achetés" items={data.flopAchete} keyLabel="designation" accent="text-slate-500" />
      </div>

      {/* À réapprovisionner */}
      {!isFinance && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <PackagePlus className="w-4 h-4 text-brand-600" /> Produits à réapprovisionner
            </h3>
            <button className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => navigate('/rapports/approvisionnement')}>
              Voir le rapport complet →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th-static">Code</th><th className="th-static">Médicament</th>
                  <th className="th-static">Stock actuel</th><th className="th-static">Stock min.</th>
                  <th className="th-static">Qté suggérée</th><th className="th-static">Priorité</th>
                </tr>
              </thead>
              <tbody>
                {data.reappro.length === 0 && (
                  <tr><td colSpan={6} className="td text-center text-slate-400 py-8">Aucun produit à réapprovisionner 🎉</td></tr>
                )}
                {data.reappro.map((r: any) => (
                  <tr key={r.id} className="tr-hover">
                    <td className="td font-mono text-xs">{r.code}</td>
                    <td className="td font-medium max-w-[280px] truncate">{r.medicament}</td>
                    <td className="td">{r.stockActuel}</td>
                    <td className="td text-slate-400">{r.stockMinimal}</td>
                    <td className="td font-bold text-brand-700">{r.quantiteSuggeree}</td>
                    <td className="td">
                      <Badge statut={r.priorite} label={r.priorite === 'ELEVE' ? 'ÉLEVÉ' : r.priorite} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {can('finance', 'read') && (
        <div className="text-center">
          <button className="text-sm font-semibold text-brand-600 hover:underline" onClick={() => navigate('/finance')}>
            💰 Accéder au tableau de bord financier complet →
          </button>
        </div>
      )}
    </div>
  );
}

function TopList({ title, items, keyLabel, accent }: { title: string; items: any[]; keyLabel: string; accent: string }) {
  const max = Math.max(1, ...items.map((i) => i.quantite));
  return (
    <div className="card p-5">
      <h3 className="font-bold text-slate-700 text-sm mb-4">{title}</h3>
      <div className="space-y-3">
        {items.length === 0 && <p className="text-xs text-slate-400">Aucune donnée sur la période</p>}
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-xs mb-1 gap-2">
              <span className="truncate font-medium text-slate-600" title={it[keyLabel]}>{it[keyLabel]}</span>
              <span className={`font-bold shrink-0 ${accent}`}>{fmtNum(it.quantite)} · {fmtMoney(it.total)}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 rounded-full transition-all duration-500"
                style={{ width: `${(it.quantite / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
