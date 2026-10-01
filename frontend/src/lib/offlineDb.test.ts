import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  createOfflineInvoice,
  createOfflineStockAdjustment,
  getLocalInvoicesPage,
  getLocalMedication,
  getSyncSummary,
  getReadyQueue,
  listQueue,
  markQueueFailed,
  markQueueSynced,
  discardQueue,
  resetOfflineDbConnection,
  saveMedicaments,
  clearLocalBusinessData,
} from './offlineDb';

beforeAll(() => {
  (globalThis as any).indexedDB = new IDBFactory();
});

afterAll(() => resetOfflineDbConnection());

describe('base métier locale et file durable', () => {
  it('conserve le prix snapshot, décrémente le stock puis acquitte la même opération', async () => {
    await clearLocalBusinessData();
    await saveMedicaments([{
      id: 42, code: 'P-42', nom: 'Produit test', designation: 'Produit test', emballage: 'BTE',
      prixAchat: 5, prixVente: 12.5, stock: 10, stockMinimal: 2, actif: true,
    }]);
    const med = await getLocalMedication(42);
    expect(med?.stock).toBe(10);

    const invoice = await createOfflineInvoice({
      clientId: '11111111-1111-4111-8111-111111111111',
      user: { id: 7, username: 'offline', prenom: 'Offline', nom: 'User' },
      payload: {
        syncId: '11111111-1111-4111-8111-111111111111',
        date: '2026-10-01T10:00:00.000Z',
        modePaiement: 'ESPECES', montantRecu: 20,
        items: [{ medicamentId: 42, quantite: 2, prixUnitaire: 12.5 }],
      },
      lines: [{ med: med!, qty: 2 }],
    });

    expect(invoice.items[0].prixUnitaire).toBe(12.5);
    expect(invoice.total).toBe(25);
    expect((await getSyncSummary()).pending).toBe(1);
    expect((await getLocalInvoicesPage({}, 1, 20)).items[0].syncStatus).toBe('PENDING');

    await markQueueSynced('vente:11111111-1111-4111-8111-111111111111', {
      id: 900, numero: 'FAC-2026-000001', total: 25, montantRecu: 20,
      modePaiement: 'ESPECES', statut: 'VALIDEE', items: invoice.items,
    });
    const summary = await getSyncSummary();
    expect(summary.pending).toBe(0);
    expect(summary.synced).toBe(1);
    const after = (await getLocalMedication(42))!;
    expect(after.stock).toBe(8);
    expect((await listQueue())[0].status).toBe('SYNCED');

    const secondId = '22222222-2222-4222-8222-222222222222';
    await createOfflineInvoice({
      clientId: secondId,
      user: { id: 7, username: 'offline', prenom: 'Offline', nom: 'User' },
      payload: { syncId: secondId, date: '2026-10-01T11:00:00.000Z', modePaiement: 'ESPECES', montantRecu: 12.5, items: [{ medicamentId: 42, quantite: 1, prixUnitaire: 12.5 }] },
      lines: [{ med: after, qty: 1 }],
    });
    expect((await getLocalMedication(42))?.stock).toBe(7);
    await markQueueFailed(`vente:${secondId}`, 'serveur indisponible', true, new Date().toISOString());
    expect((await getSyncSummary()).failed).toBe(1);
    await discardQueue(`vente:${secondId}`);
    expect((await getLocalMedication(42))?.stock).toBe(8);

    const firstAdjustment = await createOfflineStockAdjustment({
      clientId: '33333333-3333-4333-8333-333333333333', userId: 7,
      medicament: (await getLocalMedication(42))!, nouveauStock: 6, motif: 'Comptage du rayon',
    });
    const secondAdjustment = await createOfflineStockAdjustment({
      clientId: '44444444-4444-4444-8444-444444444444', userId: 7,
      medicament: (await getLocalMedication(42))!, nouveauStock: 5, motif: 'Deuxième comptage',
    });
    expect(firstAdjustment.payload.baseStock).toBe(8);
    expect(secondAdjustment.payload.baseStock).toBe(6);
    expect(secondAdjustment.payload.baseVersion).toBeUndefined();
    expect((await getReadyQueue()).map((q) => q.id)).toEqual([
      'stock:33333333-3333-4333-8333-333333333333',
      'stock:44444444-4444-4444-8444-444444444444',
    ]);
  });
});
