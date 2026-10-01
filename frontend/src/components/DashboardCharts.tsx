import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend, LineChart, Line,
} from 'recharts';
import { Boxes, ShoppingCart, TrendingUp, Truck } from 'lucide-react';
import { fmtNum } from '../lib/format';

const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#f97316', '#991b1b'];

export default function DashboardCharts({ data, series }: { data: any; series: any[] }) {
  const chartTooltipStyle = {
    contentStyle: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12, boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)' },
    formatter: (v: any, name: string) => [fmtNum(v), name],
  };

  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-6">
        <div className="card p-5 xl:col-span-2">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-600" /> Évolution des ventes, achats & marge
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="gca" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip {...chartTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="ca" name="Chiffre d'affaires" stroke="#0d9488" strokeWidth={2} fill="url(#gca)" />
                <Area type="monotone" dataKey="achats" name="Achats" stroke="#8b5cf6" strokeWidth={1.5} fill="transparent" />
                <Area type="monotone" dataKey="marge" name="Marge" stroke="#f59e0b" strokeWidth={1.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <Boxes className="w-4 h-4 text-brand-600" /> Répartition du stock
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Stock normal', value: data.stockRepartition.normal },
                    { name: 'Stock faible', value: data.stockRepartition.faible },
                    { name: 'Stock épuisé', value: data.stockRepartition.epuise },
                    { name: 'Expiration proche', value: data.stockRepartition.expirationProche },
                    { name: 'Expiré', value: data.stockRepartition.expire },
                  ].filter((x) => x.value > 0)}
                  dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}
                >
                  {[0, 1, 2, 3, 4].map((i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => [`${v} produit(s)`, '']} contentStyle={chartTooltipStyle.contentStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <div className="card p-5">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <Truck className="w-4 h-4 text-violet-500" /> Dépenses d'approvisionnement
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={(v) => (v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                <Tooltip {...chartTooltipStyle} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="achats" name="Achats (CDF)" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-brand-600" /> Nombre de ventes par jour
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle.contentStyle} />
                <Line type="monotone" dataKey="nbVentes" name="Ventes" stroke="#0d9488" strokeWidth={2.5} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </>
  );
}
