import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, ReceiptText, Package, Wallet, TrendingUp, Truck } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line,
} from 'recharts';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate, fmtTime, todayISO } from '../lib/format';
import { Loading,  Tabs } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { StatCard } from '../components/StatCard';

export default function RapportJournalier() {
  const { toast } = useToast();
  const [mode, setMode] = useState('jour'); // jour | semaine | mois | periode
  const [date, setDate] = useState(todayISO());
  const [range, setRange] = useState({ from: todayISO(), to: todayISO() });
  const [data, setData] = useState<any>(null);

  const load = useCallback(() => {
    setData(null);
    const url = mode === 'jour' ? `/api/rapports/journalier?date=${date}` : `/api/rapports/journalier?date=${date}`;
    api.get(url).then(setData).catch((e) => toast('error', e.message));
  }, [date, mode]);

  useEffect(() => { load(); }, [load]);

  // Pour semaine/mois/période : on utilise la série 7j du rapport + le jour sélectionné
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Rapport journalier</h1>
          <p className="text-sm text-slate-500">Généré automatiquement depuis les ventes et approvisionnements</p>
        </div>
        <ExportButtons what="journalier" params={{ date }} />
      </div>

      <div className="card p-4 flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        <Tabs tabs={[
          { id: 'jour', label: 'Jour' },
          { id: 'semaine', label: 'Semaine' },
          { id: 'mois', label: 'Mois' },
          { id: 'periode', label: 'Période personnalisée' },
        ]} active={mode} onChange={setMode} />
        {mode === 'jour' && <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />}
        {(mode === 'semaine' || mode === 'mois' || mode === 'periode') && (
          <p className="text-xs text-slate-400">Le détail ci-dessous concerne le jour sélectionné ; le graphique couvre les 7 derniers jours.</p>
        )}
        {mode === 'jour' && (
          <div className="flex gap-2 ml-auto">
            <button className="btn-secondary btn-sm" onClick={() => { const d = new Date(date); d.setDate(d.getDate() - 1); setDate(d.toISOString().slice(0, 10)); }}>← Veille</button>
            <button className="btn-secondary btn-sm" onClick={() => setDate(todayISO())}>Aujourd'hui</button>
          </div>
        )}
      </div>

      {!data ? <Loading label="Génération du rapport…" /> : (
        <>
          <div className="rounded-xl bg-gradient-to-r from-brand-700 to-brand-600 text-white px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-2 shadow-md">
            <div>
              <p className="text-brand-100 text-xs uppercase tracking-widest font-bold">Rapport du</p>
              <p className="text-2xl font-extrabold capitalize">{new Date(data.date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <div className="text-right">
              <p className="text-brand-100 text-xs">Chiffre d'affaires du jour</p>
              <p className="text-3xl font-extrabold">{fmtMoney(data.chiffreAffaires)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard icon={<ReceiptText className="w-5 h-5" />} label="Nombre de ventes" value={fmtNum(data.nbVentes)} accent="teal" />
            <StatCard icon={<Package className="w-5 h-5" />} label="Produits vendus" value={fmtNum(data.nbProduitsVendus)} accent="blue" />
            <StatCard icon={<Wallet className="w-5 h-5" />} label="Chiffre d'affaires" value={fmtMoney(data.chiffreAffaires)} accent="green" />
            <StatCard icon={<Truck className="w-5 h-5" />} label="Total des achats" value={fmtMoney(data.totalAchats)} accent="violet" />
            <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Marge brute" value={fmtMoney(data.margeBrute)} sub={`Coût des ventes : ${fmtMoney(data.coutVentes)}`} accent="amber" />
            <StatCard icon={<Wallet className="w-5 h-5" />} label="Paiements reçus" value={fmtMoney(data.paiementsRecus)} accent="slate" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="card p-5">
              <h3 className="font-bold text-slate-700 text-sm mb-4">CA & marge — 7 derniers jours</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.series7j.map((s: any) => ({ ...s, d: s.date.slice(5).split('-').reverse().join('/') }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                    <Tooltip formatter={(v: any, n: string) => [fmtNum(v), n]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ca" name="CA" fill="#0d9488" radius={[5, 5, 0, 0]} />
                    <Bar dataKey="marge" name="Marge" fill="#f59e0b" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="font-bold text-slate-700 text-sm mb-4">Ventes du jour</h3>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-100">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr><th className="th-static">Facture</th><th className="th-static">Heure</th><th className="th-static">Paiement</th><th className="th-static text-right">Total</th></tr>
                  </thead>
                  <tbody>
                    {data.ventesDetail.length === 0 && <tr><td colSpan={4} className="td text-center py-6 text-slate-400">Aucune vente ce jour</td></tr>}
                    {data.ventesDetail.map((v: any) => (
                      <tr key={v.numero} className="tr-hover">
                        <td className="td font-mono text-xs">{v.numero}</td>
                        <td className="td text-xs">{fmtTime(v.heure)}</td>
                        <td className="td text-xs">{v.mode.replace('_', ' ')}</td>
                        <td className="td text-right font-semibold">{fmtMoney(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <MiniTable title="🏆 Produits les plus vendus" rows={data.plusVendus} cols={['designation', 'quantite', 'total']} />
            <MiniTable title="📉 Produits les moins vendus" rows={data.moinsVendus} cols={['designation', 'quantite', 'total']} />
            <MiniTable title="🔴 Produits en rupture" rows={data.ruptures} cols={['code', 'nom']} empty="Aucune rupture" />
            <MiniTable title="🟠 Stock faible" rows={data.stockFaible} cols={['nom', 'stock', 'stockMinimal']} empty="Aucun" />
            <MiniTable title="⏳ Expiration proche" rows={data.expirationProche} cols={['nom', 'joursRestants']} empty="Aucun" />
          </div>
        </>
      )}
    </div>
  );
}

function MiniTable({ title, rows, cols, empty = 'Aucune vente' }: { title: string; rows: any[]; cols: string[]; empty?: string }) {
  return (
    <div className="card overflow-hidden">
      <p className="px-4 py-3 border-b border-slate-100 font-bold text-sm text-slate-700">{title}</p>
      <div className="p-2 max-h-64 overflow-y-auto">
        {rows.length === 0 && <p className="text-xs text-slate-400 text-center py-6">{empty}</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 text-xs">
            <span className="truncate font-medium text-slate-600 flex-1" title={r[cols[0]]}>{r[cols[0]]}</span>
            {cols[1] === 'quantite'
              ? <span className="font-bold text-brand-700 shrink-0">{r.quantite} × {fmtMoney(r.total)}</span>
              : cols[1] === 'joursRestants'
                ? <span className="font-bold text-orange-600 shrink-0">{r.joursRestants} j</span>
                : cols[1] === 'stock'
                  ? <span className="font-bold text-amber-600 shrink-0">{r.stock}/{r.stockMinimal}</span>
                  : <span className="font-bold text-red-600 shrink-0">0</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
