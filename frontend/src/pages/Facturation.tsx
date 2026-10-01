import { useEffect, useRef, useState } from 'react';
import { Search, Plus, Minus, Trash2, ShoppingCart, CreditCard, Banknote, Smartphone, ReceiptText, X, Printer, PackageX } from 'lucide-react';
import { ApiError, api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fmtMoney, fmtNum, fmtDateTime, STATUT_COLORS } from '../lib/format';
import {
  createOfflineInvoice,
  createStableUuid,
  markQueueFailed,
  markQueueSynced,
  searchLocalMedicaments,
  saveMedicaments,
  type LocalMedication,
} from '../lib/offlineDb';
import { Modal, Badge, EmptyState } from '../components/ui';

type Med = LocalMedication;
interface CartLine { med: Med; qty: number }

const MODES = [
  { id: 'ESPECES', label: 'Espèces', icon: Banknote },
  { id: 'MOBILE_MONEY', label: 'Mobile Money', icon: Smartphone },
  { id: 'CARTE', label: 'Carte', icon: CreditCard },
  { id: 'CREDIT', label: 'Crédit', icon: ReceiptText },
];

export default function Facturation() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Med[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState('ESPECES');
  const [recu, setRecu] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [facture, setFacture] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // La recherche locale est la première source : elle reste disponible après
  // fermeture/redémarrage et ne dépend pas d'un simple indicateur Wi-Fi.
  // L'API rafraîchit ensuite les résultats lorsqu'elle répond réellement.
  useEffect(() => {
    if (q.trim().length < 1) { setResults([]); return; }
    let active = true;
    const controller = new AbortController();
    setSearching(true);
    const t = window.setTimeout(() => {
      void (async () => {
        const local = await searchLocalMedicaments(q.trim()).catch(() => []);
        if (active && local.length) setResults(local as Med[]);
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (active) setSearching(false);
          return;
        }
        try {
          const remote = await api.get(`/api/medicaments/search?q=${encodeURIComponent(q.trim())}`, { timeoutMs: 7_000, signal: controller.signal });
          await saveMedicaments(remote).catch(() => {});
          if (active) setResults(remote);
        } catch {
          if (active && !local.length) setResults([]);
        } finally {
          if (active) setSearching(false);
        }
      })();
    }, 220);
    return () => { active = false; controller.abort(); window.clearTimeout(t); };
  }, [q]);

  const addToCart = (med: Med) => {
    if (med.stock <= 0) return toast('error', `Stock épuisé pour "${med.nom}"`);
    if (med.prixVente <= 0) return toast('warning', `Prix non défini pour "${med.nom}" (Prix = ${fmtMoney(med.prixVente)}) — contactez l'administrateur`);
    setCart((c) => {
      const existing = c.find((l) => l.med.id === med.id);
      if (existing) {
        if (existing.qty + 1 > med.stock) { toast('error', 'Stock insuffisant'); return c; }
        return c.map((l) => (l.med.id === med.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...c, { med, qty: 1 }];
    });
    setQ(''); setResults([]);
    inputRef.current?.focus();
  };

  const setQty = (id: number, qty: number) => {
    setCart((c) => c.map((l) => {
      if (l.med.id !== id) return l;
      if (qty > l.med.stock) { toast('error', `Stock insuffisant (disponible : ${l.med.stock})`); return l; }
      return { ...l, qty: Math.max(1, qty) };
    }));
  };

  const removeLine = (id: number) => setCart((c) => c.filter((l) => l.med.id !== id));

  const sousTotal = (l: CartLine) => l.qty * l.med.prixVente;
  const total = cart.reduce((s, l) => s + sousTotal(l), 0);
  const monnaie = Math.max(0, (parseFloat(recu) || 0) - total);

  const valider = async () => {
    if (!cart.length) return;
    if (mode !== 'CREDIT' && (parseFloat(recu) || 0) < total) {
      return toast('error', 'Montant reçu insuffisant');
    }
    setBusy(true);
    const clientId = createStableUuid();
    const payload = {
      syncId: clientId,
      date: new Date().toISOString(),
      items: cart.map((l) => ({ medicamentId: l.med.id, quantite: l.qty, prixUnitaire: Number(l.med.prixVente) })),
      modePaiement: mode,
      remise: 0,
      montantRecu: mode === 'CREDIT' ? 0 : parseFloat(recu) || total,
    };
    const lines = cart.map((line) => ({ med: line.med, qty: line.qty }));

    try {
      // First commit the invoice, its immutable price snapshots, the local
      // stock reservation and the queue in one IndexedDB transaction. If the
      // process is killed during the network request, the queue resumes later.
      const localInvoice = await createOfflineInvoice({ clientId, payload, user, lines });
      try {
        const vente = await api.post('/api/ventes', payload);
        await markQueueSynced(`vente:${clientId}`, vente);
        setFacture(vente);
        setCart([]); setRecu(''); setMode('ESPECES');
        toast('success', vente.syncConflict ? `Vente ${vente.numero} enregistrée — conflit de prix signalé, prix historique conservé` : `Vente ${vente.numero} enregistrée — stock mis à jour`);
      } catch (error: any) {
        if (!(error instanceof ApiError) || error.status === 0) {
          // Keep PENDING for automatic retry after a real API recovery.
          setFacture(localInvoice);
          setCart([]); setRecu(''); setMode('ESPECES');
          toast('warning', 'Vente enregistrée hors connexion. Elle sera synchronisée automatiquement au retour de l’API.');
        } else {
          const retryable = error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
          const next = new Date(Date.now() + (retryable ? 4_000 : 24 * 60 * 60 * 1000)).toISOString();
          await markQueueFailed(`vente:${clientId}`, error.message, retryable, next);
          setFacture({ ...localInvoice, syncStatus: 'FAILED', lastError: error.message });
          toast('error', retryable ? `${error.message} — nouvelle tentative automatique.` : `${error.message} — opération conservée dans Synchronisation pour résolution.`);
        }
      }
    } catch (error: any) {
      // If IndexedDB is unavailable, do not pretend an offline sale was saved.
      // An online API request remains a valid fallback; a failed request is
      // reported and nothing is discarded.
      try {
        const vente = await api.post('/api/ventes', payload);
        setFacture(vente);
        setCart([]); setRecu(''); setMode('ESPECES');
        toast('success', `Vente ${vente.numero} enregistrée — stockage local indisponible`);
      } catch (apiError: any) {
        toast('error', error.message || apiError.message || 'Échec de la vente : base locale indisponible');
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Facturation</h1>
          <p className="text-sm text-slate-500">Recherchez un médicament, ajoutez-le au panier, encaissez.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Recherche + résultats */}
        <div className="xl:col-span-3 space-y-4">
          <div className="card p-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                ref={inputRef}
                className="input pl-11 py-3 text-base"
                placeholder="Rechercher par code, nom, désignation ou emballage… (ex : amoxi, 1005)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              {searching && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 animate-pulse">recherche…</span>}
            </div>

            {q && (
              <div className="mt-3 max-h-[420px] overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-50">
                {results.length === 0 && !searching && (
                  <EmptyState icon={<PackageX className="w-10 h-10" />} title="Aucun médicament trouvé"
                    subtitle="Vérifiez l'orthographe ou ajoutez le produit via le module Approvisionnement." />
                )}
                {results.map((m) => (
                  <button key={m.id} onClick={() => addToCart(m)} disabled={m.stock <= 0}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50/60 transition-colors text-left disabled:opacity-50 disabled:hover:bg-transparent">
                    <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center shrink-0">
                      <Plus className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{m.nom}</p>
                      <p className="text-xs text-slate-400">
                        <span className="font-mono">{m.code}</span> · {m.emballage || '—'} ·{' '}
                        <span className={m.stock <= 0 ? 'text-red-500 font-semibold' : m.stock <= m.stockMinimal ? 'text-amber-600 font-semibold' : ''}>
                          Stock : {m.stock}
                        </span>
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm text-brand-700">{m.prixVente > 0 ? fmtMoney(m.prixVente) : 'Prix non défini'}</p>
                      {(m.statut || 'NORMAL') !== 'NORMAL' && <Badge statut={m.statut || 'NORMAL'} label={(m.statutLibelle || '').replace(/^[^\s]+\s/, '')} />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Panier */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/60">
              <ShoppingCart className="w-4 h-4 text-brand-600" />
              <h3 className="font-bold text-sm text-slate-700">Panier ({cart.length} ligne{cart.length > 1 ? 's' : ''})</h3>
              {cart.length > 0 && (
                <button className="ml-auto text-xs text-red-500 hover:underline" onClick={() => setCart([])}>Vider</button>
              )}
            </div>
            {cart.length === 0 ? (
              <EmptyState icon={<ShoppingCart className="w-10 h-10" />} title="Panier vide"
                subtitle="Recherchez un médicament ci-dessus et cliquez dessus pour l'ajouter." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="th-static">Médicament</th>
                      <th className="th-static">P.U.</th>
                      <th className="th-static text-center">Quantité</th>
                      <th className="th-static text-right">Sous-total</th>
                      <th className="th-static w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l) => (
                      <tr key={l.med.id} className="tr-hover">
                        <td className="td">
                          <p className="font-medium text-slate-800 max-w-[240px] truncate">{l.med.nom}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{l.med.code} · {l.med.emballage}</p>
                        </td>
                        <td className="td">{fmtMoney(l.med.prixVente)}</td>
                        <td className="td">
                          <div className="flex items-center justify-center gap-1">
                            <button className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" onClick={() => setQty(l.med.id, l.qty - 1)}>
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input type="number" min={1} max={l.med.stock} value={l.qty}
                              onChange={(e) => setQty(l.med.id, parseInt(e.target.value) || 1)}
                              className="input w-16 text-center py-1 px-1" />
                            <button className="p-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600" onClick={() => setQty(l.med.id, l.qty + 1)}>
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-[10px] text-center text-slate-400 mt-0.5">dispo : {l.med.stock}</p>
                        </td>
                        <td className="td text-right font-bold text-slate-800">{fmtMoney(sousTotal(l))}</td>
                        <td className="td">
                          <button className="p-1.5 rounded-md text-red-400 hover:bg-red-50 hover:text-red-600" onClick={() => removeLine(l.med.id)}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Paiement */}
        <div className="xl:col-span-2">
          <div className="card p-5 sticky top-4 space-y-5">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand-600" /> Paiement
            </h3>

            <div className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-all ${
                    mode === m.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                  <m.icon className="w-4 h-4" /> {m.label}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2">
              <div className="flex justify-between text-sm text-slate-500">
                <span>Articles</span><span>{cart.reduce((s, l) => s + l.qty, 0)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate-500">
                <span>Lignes</span><span>{cart.length}</span>
              </div>
              <div className="flex justify-between text-lg font-extrabold text-slate-800 border-t border-slate-200 pt-2">
                <span>TOTAL</span><span className="text-brand-700">{fmtMoney(total)}</span>
              </div>
            </div>

            {mode !== 'CREDIT' && (
              <div>
                <label className="label">Montant reçu (CDF)</label>
                <input type="number" min={0} className="input text-lg font-bold" value={recu}
                  onChange={(e) => setRecu(e.target.value)} placeholder="0" />
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {[1000, 5000, 10000, 20000].map((v) => (
                    <button key={v} className="btn-secondary btn-sm" onClick={() => setRecu(String((parseFloat(recu) || 0) + v))}>+{fmtNum(v)}</button>
                  ))}
                  <button className="btn-secondary btn-sm" onClick={() => setRecu(String(Math.ceil(total)))}>Appoint</button>
                </div>
                {parseFloat(recu) > 0 && (
                  <p className="mt-2 text-sm font-bold text-right">
                    Monnaie : <span className={monnaie >= 0 ? 'text-emerald-600' : 'text-red-500'}>{fmtMoney(monnaie)}</span>
                  </p>
                )}
              </div>
            )}
            {mode === 'CREDIT' && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Vente à crédit : le montant sera enregistré en créance.
              </p>
            )}

            <button className="btn-primary w-full py-3.5 text-base" disabled={!cart.length || busy} onClick={valider}>
              {busy ? 'Enregistrement…' : `✓ Valider la vente — ${fmtMoney(total)}`}
            </button>
            <p className="text-[11px] text-center text-slate-400">
              Le stock est déduit automatiquement et la facture numérotée (FAC-AAAA-NNNNNN).
            </p>
          </div>
        </div>
      </div>

      {/* Facture après validation */}
      <Modal open={!!facture} onClose={() => setFacture(null)} title={`Facture ${facture?.numero || ''}`} wide>
        {facture && <FacturePrint facture={facture} />}
        <div className="flex justify-end gap-2 mt-4 no-print">
          <button className="btn-secondary" onClick={() => setFacture(null)}>Fermer</button>
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer className="w-4 h-4" /> Imprimer la facture
          </button>
        </div>
      </Modal>
    </div>
  );
}

// Aperçu imprimable de la facture (aussi utilisé par la page Ventes)
export function FacturePrint({ facture }: { facture: any }) {
  return (
    <div id="print-area" className="bg-white">
      <div className="flex items-start justify-between gap-4 pb-4 border-b-2 border-brand-600">
        <div className="flex items-center gap-3">
          <svg width="52" height="52" viewBox="0 0 100 100">
            <rect width="100" height="100" rx="22" fill="#0d9488" />
            <rect x="42" y="16" width="16" height="68" rx="5" fill="white" />
            <rect x="16" y="42" width="68" height="16" rx="5" fill="white" />
          </svg>
          <div>
            <h2 className="text-xl font-extrabold text-brand-700 leading-tight">AMI PHARMA</h2>
            <p className="text-[11px] text-slate-500 leading-tight">AVENUE NGUMA N° 3 Q/JOLI PARC C/NGALIEMA</p>
            <p className="text-[11px] text-slate-500 leading-tight">KINSHASA / RDC — Tél : 0820829592 - 0812271621</p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-600 shrink-0">
          <p className="text-lg font-extrabold text-slate-800">FACTURE</p>
          <p className="font-mono font-bold text-brand-700">{facture.numero}</p>
          <p>Date : {fmtDateTime(facture.date)}</p>
          <p>Caissier : {facture.user?.prenom} {facture.user?.nom}</p>
          {facture.statut === 'ANNULEE' && <p className="text-red-600 font-bold mt-1">❌ ANNULÉE</p>}
        </div>
      </div>

      <table className="w-full mt-4 text-sm">
        <thead>
          <tr className="bg-brand-600 text-white">
            <th className="text-left px-3 py-2 font-semibold">Désignation</th>
            <th className="text-center px-3 py-2 font-semibold w-16">Qté</th>
            <th className="text-right px-3 py-2 font-semibold w-28">P.U. (CDF)</th>
            <th className="text-right px-3 py-2 font-semibold w-32">Sous-total (CDF)</th>
          </tr>
        </thead>
        <tbody>
          {facture.items?.map((it: any, i: number) => (
            <tr key={it.id || i} className={i % 2 ? 'bg-brand-50/40' : ''}>
              <td className="px-3 py-2">
                <span className="font-medium">{it.designation}</span>
                {it.emballage && <span className="text-xs text-slate-400 ml-2">({it.emballage})</span>}
              </td>
              <td className="px-3 py-2 text-center">{it.quantite}</td>
              <td className="px-3 py-2 text-right">{fmtNum(it.prixUnitaire)}</td>
              <td className="px-3 py-2 text-right font-semibold">{fmtNum(it.sousTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex justify-end mt-4">
        <div className="w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-slate-500">
            <span>Mode de paiement</span>
            <span className={`badge ${STATUT_COLORS[facture.modePaiement]}`}>{(facture.modePaiement || '').replace('_', ' ')}</span>
          </div>
          {Number(facture.remise || 0) > 0 && (
            <div className="flex justify-between text-slate-500"><span>Remise</span><span>- {fmtMoney(facture.remise)}</span></div>
          )}
          <div className="flex justify-between text-lg font-extrabold border-t-2 border-slate-200 pt-2">
            <span>TOTAL</span><span className="text-brand-700">{fmtMoney(facture.total)}</span>
          </div>
          {facture.statut === 'VALIDEE' && (
            <>
              <div className="flex justify-between text-slate-500"><span>Montant reçu</span><span>{fmtMoney(facture.montantRecu)}</span></div>
              <div className="flex justify-between font-bold text-emerald-600">
                <span>Monnaie</span><span>{fmtMoney(Math.max(0, (facture.montantRecu || 0) - facture.total))}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-10 flex justify-between items-end text-xs text-slate-500">
        <div>
          <p className="mb-8">Signature / Cachet :</p>
          <p className="border-t border-slate-300 pt-1 w-44">AMI PHARMA</p>
        </div>
        <p className="italic">Merci de votre visite — Prompt rétablissement !</p>
      </div>
    </div>
  );
}
