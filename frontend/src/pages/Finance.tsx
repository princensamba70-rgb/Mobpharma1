import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet, TrendingUp, TrendingDown, Boxes, Landmark, Scale, FileBarChart, PiggyBank, HandCoins,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  AreaChart, Area, BarChart, Bar,
} from 'recharts';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import { Loading, Tabs } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { StatCard } from '../components/StatCard';

const yFmt = (v: number) => (Math.abs(v) >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));
const tooltipStyle = { contentStyle: { borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0' }, formatter: (v: any, n: string) => [fmtNum(v), n] };

export default function Finance() {
  const { toast } = useToast();
  const [tab, setTab] = useState('dashboard');
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState({ from: '', to: '' });

  const qs = useMemo(() => {
    if (period === 'custom' && range.from && range.to) return `?from=${range.from}&to=${range.to}`;
    if (period === 'year') { const y = new Date().getFullYear(); return `?from=${y}-01-01&to=${y}-12-31`; }
    return `?period=${period}`;
  }, [period, range]);

  const [rapport, setRapport] = useState<any>(null);
  const [situation, setSituation] = useState<any>(null);
  const [bilan, setBilan] = useState<any>(null);

  const load = useCallback(() => {
    setRapport(null);
    Promise.all([
      api.get(`/api/rapports/financier${qs}`),
      api.get(`/api/rapports/situation${qs}`),
      api.get('/api/rapports/bilan'),
    ]).then(([r, s, b]) => { setRapport(r); setSituation(s); setBilan(b); })
      .catch((e) => toast('error', e.message));
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  if (!rapport) return <Loading label="Chargement des données financières…" />;

  const series = rapport.series.map((s: any) => ({ ...s, d: s.date.slice(5).split('-').reverse().join('/') }));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Finance</h1>
          <p className="text-sm text-slate-500">Tableau de bord financier, situation, bilan et rapports — devise CDF</p>
        </div>
        <ExportButtons what="situation" params={period === 'custom' ? { from: range.from, to: range.to } : { period }} />
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <Tabs tabs={[
          { id: 'dashboard', label: '📊 Tableau de bord' },
          { id: 'situation', label: '🧾 Situation financière' },
          { id: 'bilan', label: '⚖️ Bilan' },
          { id: 'rapport', label: '📑 Rapport financier' },
        ]} active={tab} onChange={setTab} />
        <div className="flex gap-2 items-center lg:ml-auto flex-wrap">
          <Tabs tabs={[
            { id: 'today', label: 'Jour' }, { id: 'week', label: '7 jours' },
            { id: 'month', label: '30 jours' }, { id: 'year', label: 'Année' }, { id: 'custom', label: 'Personnalisée' },
          ]} active={period} onChange={setPeriod} />
          {period === 'custom' && (
            <div className="flex gap-1.5 items-center">
              <input type="date" className="input w-auto py-1.5 text-xs" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span className="text-slate-400 text-xs">→</span>
              <input type="date" className="input w-auto py-1.5 text-xs" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
          )}
        </div>
      </div>

      {tab === 'dashboard' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard icon={<Wallet className="w-5 h-5" />} label="Chiffre d'affaires" value={fmtMoney(rapport.chiffreAffaires)} sub={`${rapport.nbVentes} vente(s)`} accent="teal" />
            <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Dépenses d'approvisionnement" value={fmtMoney(rapport.totalAchats)} sub={`${rapport.nbApprovisionnements} commande(s)`} accent="violet" />
            <StatCard icon={<Boxes className="w-5 h-5" />} label="Valeur du stock" value={fmtMoney(rapport.valeurStock)} accent="blue" />
            <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Marge brute" value={fmtMoney(rapport.margeBrute)} sub={`Coût : ${fmtMoney(rapport.coutVentes)}`} accent="green" />
            <StatCard icon={<HandCoins className="w-5 h-5" />} label="Créances" value={fmtMoney(rapport.creances)} sub="ventes à crédit" accent="amber" />
            <StatCard icon={<PiggyBank className="w-5 h-5" />} label="Résultat" value={fmtMoney(rapport.resultat)} sub={`Dépenses : ${fmtMoney(rapport.depenses)}`} accent={rapport.resultat >= 0 ? 'green' : 'red'} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <ChartCard title="Évolution des ventes & achats">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} /><stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={yFmt} />
                  <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="ca" name="Ventes" stroke="#0d9488" strokeWidth={2} fill="url(#gv)" />
                  <Area type="monotone" dataKey="achats" name="Achats" stroke="#8b5cf6" strokeWidth={2} fill="url(#ga)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Évolution de la marge brute">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={yFmt} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="marge" name="Marge" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Dépenses d'approvisionnement par jour">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={yFmt} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="achats" name="Achats (CDF)" fill="#8b5cf6" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Paiements reçus par jour">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series.map((s: any) => ({ ...s }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={yFmt} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: '#f0fdfa' }} />
                  <Bar dataKey="ca" name="Encaissé (CDF)" fill="#0d9488" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      {tab === 'situation' && situation && (
        <div className="max-w-3xl mx-auto">
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-brand-700 to-brand-600 text-white px-6 py-4">
              <h3 className="font-extrabold text-lg">SITUATION FINANCIÈRE</h3>
              <p className="text-brand-100 text-xs">Période : {fmtDate(situation.periode.from)} → {fmtDate(situation.periode.to)}</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {[
                  ['Total achats (approvisionnement)', situation.totalAchats, 'text-violet-700'],
                  ['Total ventes / Chiffre d\'affaires', situation.chiffreAffaires, 'text-brand-700'],
                  ['Marge brute', situation.margeBrute, 'text-emerald-600'],
                  ['Valeur du stock (prix d\'achat)', situation.valeurStock, 'text-sky-700'],
                  ['Dépenses', situation.depenses, 'text-red-600'],
                  ['Paiements reçus', situation.paiementsRecus, 'text-slate-700'],
                  ['Créances (ventes à crédit)', situation.creances, 'text-amber-600'],
                ].map(([label, val, color], i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-6 py-3 text-slate-600">{label as string}</td>
                    <td className={`px-6 py-3 text-right font-bold ${color}`}>{fmtMoney(val as number)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50">
                  <td className="px-6 py-4 font-extrabold text-slate-800">SOLDE (encaissé − achats − dépenses)</td>
                  <td className={`px-6 py-4 text-right font-extrabold text-lg ${situation.solde >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(situation.solde)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'bilan' && bilan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 max-w-5xl mx-auto">
          <div className="card overflow-hidden">
            <div className="bg-emerald-600 text-white px-6 py-3 font-extrabold flex items-center gap-2">
              <Landmark className="w-4 h-4" /> ACTIF
            </div>
            <table className="w-full text-sm">
              <tbody>
                <BilanRow label="Valeur du stock (prix d'achat)" value={bilan.actif.valeurStock} />
                <BilanRow label="Trésorerie (encaissements − décaissements)" value={bilan.actif.tresorerie} />
                <BilanRow label="Créances (ventes à crédit)" value={bilan.actif.creances} />
                <tr className="bg-emerald-50 font-extrabold">
                  <td className="px-6 py-3.5">TOTAL ACTIF</td>
                  <td className="px-6 py-3.5 text-right text-emerald-700">{fmtMoney(bilan.actif.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card overflow-hidden">
            <div className="bg-violet-600 text-white px-6 py-3 font-extrabold flex items-center gap-2">
              <Scale className="w-4 h-4" /> PASSIF
            </div>
            <table className="w-full text-sm">
              <tbody>
                <BilanRow label="Capitaux propres (apports)" value={bilan.passif.capitauxPropres} />
                <BilanRow label="Dettes fournisseurs" value={bilan.passif.dettesFournisseurs} note="extensible" />
                <BilanRow label="Résultat de la période" value={bilan.passif.resultat} />
                <tr className="bg-violet-50 font-extrabold">
                  <td className="px-6 py-3.5">TOTAL PASSIF</td>
                  <td className="px-6 py-3.5 text-right text-violet-700">{fmtMoney(bilan.passif.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="lg:col-span-2 card p-5">
            <h4 className="font-bold text-slate-700 text-sm mb-3">Mémo — cumul depuis l'ouverture</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Chiffre d'affaires</p><p className="font-bold text-brand-700">{fmtMoney(bilan.memo.chiffreAffaires)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Total achats</p><p className="font-bold text-violet-700">{fmtMoney(bilan.memo.totalAchats)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Coût des ventes</p><p className="font-bold text-slate-600">{fmtMoney(bilan.memo.coutVentes)}</p></div>
              <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-400">Dépenses</p><p className="font-bold text-red-600">{fmtMoney(bilan.memo.depenses)}</p></div>
            </div>
            <p className="text-xs text-slate-400 mt-3">
              Bilan généré automatiquement à partir des transactions enregistrées en base. Équilibre Actif = Passif garanti par le calcul des capitaux propres.
            </p>
          </div>
        </div>
      )}

      {tab === 'rapport' && (
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-lg flex items-center gap-2"><FileBarChart className="w-5 h-5" /> RAPPORT FINANCIER</h3>
                <p className="text-slate-300 text-xs">Période : {fmtDate(rapport.periode.from)} → {fmtDate(rapport.periode.to)}</p>
              </div>
              <ExportButtons what="situation" params={period === 'custom' ? { from: range.from, to: range.to } : { period }} />
            </div>
            <table className="w-full text-sm">
              <tbody>
                <BilanRow label="Ventes (chiffre d'affaires)" value={rapport.chiffreAffaires} bold />
                <BilanRow label="Achats (approvisionnement)" value={rapport.totalAchats} />
                <BilanRow label="Coût des ventes" value={rapport.coutVentes} />
                <BilanRow label="Marge brute" value={rapport.margeBrute} bold />
                <BilanRow label="Valeur du stock" value={rapport.valeurStock} />
                <BilanRow label="Dépenses" value={rapport.depenses} />
                <BilanRow label="Créances" value={rapport.creances} />
                <tr className="bg-brand-50 font-extrabold text-base">
                  <td className="px-6 py-4">RÉSULTAT NET</td>
                  <td className={`px-6 py-4 text-right ${rapport.resultat >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtMoney(rapport.resultat)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ChartCard title="Évolution financière (CA / Achats / Marge)" tall>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="d" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={yFmt} />
                <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="ca" name="CA" stroke="#0d9488" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="achats" name="Achats" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="marge" name="Marge" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function ChartCard({ title, children, tall }: { title: string; children: React.ReactNode; tall?: boolean }) {
  return (
    <div className="card p-5">
      <h3 className="font-bold text-slate-700 text-sm mb-4">{title}</h3>
      <div className={tall ? 'h-80' : 'h-60'}>{children}</div>
    </div>
  );
}

function BilanRow({ label, value, bold, note }: { label: string; value: number; bold?: boolean; note?: string }) {
  return (
    <tr className="border-b border-slate-100">
      <td className={`px-6 py-3 text-slate-600 ${bold ? 'font-bold text-slate-800' : ''}`}>
        {label} {note && <span className="text-[10px] text-slate-400 italic">({note})</span>}
      </td>
      <td className={`px-6 py-3 text-right ${bold ? 'font-extrabold' : 'font-bold'} ${value < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtMoney(value)}</td>
    </tr>
  );
}
