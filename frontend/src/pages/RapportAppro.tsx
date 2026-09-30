import { useEffect, useState } from 'react';
import { FileBarChart, AlertOctagon, ArrowUpCircle, Info } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDate } from '../lib/format';
import { Loading, Badge } from '../components/ui';
import { ExportButtons } from '../components/ExportButtons';
import { StatCard } from '../components/StatCard';

export default function RapportAppro() {
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get('/api/rapports/approvisionnement').then(setData).catch((e) => toast('error', e.message));
  }, []);

  if (!data) return <Loading label="Génération du rapport d'approvisionnement…" />;
  const r = data.resume;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Rapport d'approvisionnement</h1>
          <p className="text-sm text-slate-500">
            Généré automatiquement le {fmtDate(data.genereLe)} — stock cible = stock minimal × {data.facteurCible} (configurable)
          </p>
        </div>
        <ExportButtons what="reapprovisionnement" />
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <StatCard icon={<FileBarChart className="w-5 h-5" />} label="Produits concernés" value={r.total} accent="teal" />
        <StatCard icon={<AlertOctagon className="w-5 h-5" />} label="URGENT (stock = 0)" value={r.urgent} accent="red" />
        <StatCard icon={<ArrowUpCircle className="w-5 h-5" />} label="ÉLEVÉ (stock < min.)" value={r.eleve} accent="amber" />
        <StatCard icon={<Info className="w-5 h-5" />} label="NORMAL (proche min.)" value={r.normal} accent="blue" />
        <StatCard icon={<FileBarChart className="w-5 h-5" />} label="Valeur estimée commande" value={fmtMoney(r.valeurEstimee)} accent="violet" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th-static">Date</th><th className="th-static">Code</th><th className="th-static">Médicament</th>
                <th className="th-static text-right">Stock actuel</th><th className="th-static text-right">Stock min.</th>
                <th className="th-static text-right">Qté recommandée</th><th className="th-static text-right">Dernier prix achat</th>
                <th className="th-static text-right">Valeur estimée</th><th className="th-static">Fournisseur</th>
                <th className="th-static">Priorité</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && <tr><td colSpan={10} className="td text-center py-12 text-slate-400">Aucun produit à réapprovisionner 🎉</td></tr>}
              {data.items.map((i: any, idx: number) => (
                <tr key={idx} className={`tr-hover ${i.priorite === 'URGENT' ? 'bg-red-50/50' : ''}`}>
                  <td className="td text-xs">{fmtDate(data.genereLe)}</td>
                  <td className="td font-mono text-xs">{i.code}</td>
                  <td className="td font-medium max-w-[260px] truncate">{i.medicament}</td>
                  <td className={`td text-right font-bold ${i.stockActuel <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{i.stockActuel}</td>
                  <td className="td text-right text-slate-400">{i.stockMinimal}</td>
                  <td className="td text-right font-bold text-brand-700">{i.quantiteSuggeree}</td>
                  <td className="td text-right">{fmtMoney(i.dernierPrixAchat)}</td>
                  <td className="td text-right font-semibold">{fmtMoney(i.valeurEstimee)}</td>
                  <td className="td text-xs">{i.fournisseur}</td>
                  <td className="td"><Badge statut={i.priorite} label={i.priorite === 'ELEVE' ? 'ÉLEVÉ' : i.priorite} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-bold">
                <td colSpan={7} className="td text-right">Valeur totale estimée de la commande :</td>
                <td className="td text-right text-brand-700">{fmtMoney(r.valeurEstimee)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
