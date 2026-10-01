/*
 * Durable business storage for the browser and Capacitor WebView.
 *
 * This is deliberately IndexedDB rather than localStorage: invoices, price
 * snapshots and the queue survive process restarts, are not limited to a few
 * megabytes of strings, and can be updated in one transaction with stock.
 * Authentication secrets never enter this database; they stay in the existing
 * Keystore/httpOnly-cookie/memory strategy.
 */

export type QueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type LocalInvoiceStatus = 'PENDING' | 'SYNCED' | 'FAILED' | 'LOCAL_CANCELLED';

export interface LocalMedication {
  id: number;
  code: string;
  nom: string;
  designation?: string | null;
  emballage?: string | null;
  prixAchat: number;
  prixVente: number;
  stock: number;
  /** Last stock value confirmed by the server. */
  serverStock?: number;
  /** Sum of durable local operations not confirmed by the server yet. */
  localStockDelta?: number;
  stockMinimal: number;
  actif: boolean;
  version?: number;
  deletedAt?: string | null;
  updatedAt?: string;
  createdAt?: string;
  categorie?: any;
  fournisseur?: any;
  statut?: string;
  statutLibelle?: string;
  expirationProchaine?: string | null;
  joursRestants?: number | null;
  valeurStockAchat?: number;
  valeurStockVente?: number;
  [key: string]: any;
}

export interface LocalPriceCatalog {
  id: number;
  numero?: number | null;
  code: string;
  designation: string;
  emballage?: string | null;
  prix: number;
  devise: string;
  source?: string;
  importedAt?: string;
  version?: number;
  [key: string]: any;
}

export interface OfflineInvoiceItem {
  id?: number | string;
  medicamentId: number;
  designation: string;
  emballage?: string | null;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
  medicament?: { code?: string };
}

export interface OfflineInvoice {
  id: number | string;
  clientId: string;
  syncId: string;
  numero: string;
  userId?: number;
  user?: any;
  date: string;
  createdAt: string;
  total: number;
  remise: number;
  montantRecu: number;
  modePaiement: string;
  statut: 'VALIDEE' | 'ANNULEE';
  motifAnnulation?: string | null;
  items: OfflineInvoiceItem[];
  syncStatus: LocalInvoiceStatus;
  syncConflict?: string | null;
  serverId?: number;
  serverNumber?: string;
  lastError?: string | null;
  localDiscarded?: boolean;
  [key: string]: any;
}

export interface StockDelta {
  medicamentId: number;
  delta: number;
}

export interface SyncQueueRecord {
  id: string;
  entity: 'vente' | 'stock';
  operation: 'CREATE_VENTE' | 'ADJUST_STOCK';
  entityId: string;
  ownerUserId?: number;
  payload: any;
  status: QueueStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  lastError?: string | null;
  retryable?: boolean;
  stockDeltas?: StockDelta[];
  response?: any;
}

export interface SyncSummary {
  pending: number;
  syncing: number;
  failed: number;
  synced: number;
  total: number;
  lastSyncAt: string | null;
  lastError: string | null;
  storageAvailable: boolean;
}

const DB_NAME = 'ami_pharma_business_v1';
const DB_VERSION = 1;
const MEDICATIONS = 'medicaments';
const CATALOG = 'catalogue_prix';
const INVOICES = 'factures';
const QUEUE = 'sync_queue';
const META = 'meta';

export function createStableUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function isOfflineDbAvailable(): boolean {
  return hasIndexedDb();
}

/** Test/diagnostic hook; normal logout deliberately does not clear business data. */
export function resetOfflineDbConnection(): void {
  if (dbPromise) void dbPromise.then((db) => db.close()).catch(() => {});
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) return Promise.reject(new Error('IndexedDB indisponible sur cet appareil'));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error('Ouverture de la base locale impossible'));
    request.onupgradeneeded = () => {
      const db = request.result;
      const medications = db.objectStoreNames.contains(MEDICATIONS)
        ? request.transaction!.objectStore(MEDICATIONS)
        : db.createObjectStore(MEDICATIONS, { keyPath: 'id' });
      if (!medications.indexNames.contains('code')) medications.createIndex('code', 'code', { unique: false });
      if (!medications.indexNames.contains('updatedAt')) medications.createIndex('updatedAt', 'updatedAt', { unique: false });
      if (!medications.indexNames.contains('actif')) medications.createIndex('actif', 'actif', { unique: false });

      const catalog = db.objectStoreNames.contains(CATALOG)
        ? request.transaction!.objectStore(CATALOG)
        : db.createObjectStore(CATALOG, { keyPath: 'id' });
      if (!catalog.indexNames.contains('code')) catalog.createIndex('code', 'code', { unique: false });
      if (!catalog.indexNames.contains('designation')) catalog.createIndex('designation', 'designation', { unique: false });
      if (!catalog.indexNames.contains('importedAt')) catalog.createIndex('importedAt', 'importedAt', { unique: false });

      const invoices = db.objectStoreNames.contains(INVOICES)
        ? request.transaction!.objectStore(INVOICES)
        : db.createObjectStore(INVOICES, { keyPath: 'clientId' });
      if (!invoices.indexNames.contains('date')) invoices.createIndex('date', 'date', { unique: false });
      if (!invoices.indexNames.contains('syncStatus')) invoices.createIndex('syncStatus', 'syncStatus', { unique: false });

      const queue = db.objectStoreNames.contains(QUEUE)
        ? request.transaction!.objectStore(QUEUE)
        : db.createObjectStore(QUEUE, { keyPath: 'id' });
      if (!queue.indexNames.contains('status')) queue.createIndex('status', 'status', { unique: false });
      if (!queue.indexNames.contains('nextAttemptAt')) queue.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
      if (!queue.indexNames.contains('createdAt')) queue.createIndex('createdAt', 'createdAt', { unique: false });

      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  }).catch((error): never => {
    dbPromise = null;
    throw error;
  });
  return dbPromise!;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Lecture de la base locale impossible'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction locale échouée'));
    tx.onabort = () => reject(tx.error || new Error('Transaction locale interrompue'));
  });
}

async function getRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).get(key) as IDBRequest<T | undefined>);
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readonly');
  return requestResult(tx.objectStore(storeName).getAll() as IDBRequest<T[]>);
}

async function putRecord(storeName: string, value: any): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return txDone(tx);
}

async function deleteRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  return txDone(tx);
}

function normaliseMedication(raw: any, previous?: LocalMedication): LocalMedication {
  const remoteStock = Number(raw.stock ?? previous?.serverStock ?? previous?.stock ?? 0);
  const delta = Number(previous?.localStockDelta || 0);
  return {
    ...previous,
    ...raw,
    id: Number(raw.id ?? previous?.id),
    prixAchat: Number(raw.prixAchat ?? previous?.prixAchat ?? 0),
    prixVente: Number(raw.prixVente ?? previous?.prixVente ?? 0),
    stockMinimal: Number(raw.stockMinimal ?? previous?.stockMinimal ?? 5),
    actif: raw.actif !== undefined ? Boolean(raw.actif) : (previous?.actif ?? true),
    serverStock: remoteStock,
    localStockDelta: delta,
    stock: remoteStock + delta,
  };
}

function normaliseCatalog(raw: any): LocalPriceCatalog {
  return {
    ...raw,
    id: Number(raw.id),
    code: String(raw.code),
    designation: String(raw.designation),
    prix: Number(raw.prix ?? 0),
    devise: String(raw.devise || 'CDF'),
  };
}

function mergePriceIntoMedication(med: LocalMedication, prices: LocalPriceCatalog[]): LocalMedication {
  if (med.prixVente > 0) return med;
  const candidate = prices.find((p) => p.code === med.code && p.prix > 0);
  return candidate ? { ...med, prixVente: candidate.prix, prixSource: 'catalogue-local' } : med;
}

export async function saveMedicaments(rows: any[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  const existing = new Map((await getAllRecords<LocalMedication>(MEDICATIONS)).map((m) => [m.id, m]));
  const tx = db.transaction(MEDICATIONS, 'readwrite');
  const store = tx.objectStore(MEDICATIONS);
  rows.forEach((row) => store.put(normaliseMedication(row, existing.get(Number(row.id)))));
  await txDone(tx);
}

export async function saveCatalogue(rows: any[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  const tx = db.transaction(CATALOG, 'readwrite');
  const store = tx.objectStore(CATALOG);
  rows.forEach((row) => store.put(normaliseCatalog(row)));
  await txDone(tx);
}

export async function mergeSyncPull(pull: { medicaments?: any[]; catalogue?: any[]; ventes?: any[] }): Promise<void> {
  await saveMedicaments(pull.medicaments || []);
  await saveCatalogue(pull.catalogue || []);
  await saveServerInvoices(pull.ventes || []);
}

export async function searchLocalMedicaments(query: string): Promise<LocalMedication[]> {
  const [medicaments, prices] = await Promise.all([
    getAllRecords<LocalMedication>(MEDICATIONS),
    getAllRecords<LocalPriceCatalog>(CATALOG),
  ]);
  const term = query.trim().toLocaleLowerCase('fr');
  return medicaments
    .filter((m) => m.actif !== false)
    .filter((m) => !term || [m.code, m.nom, m.designation, m.emballage].filter(Boolean).some((value) => String(value).toLocaleLowerCase('fr').includes(term)))
    .map((m) => mergePriceIntoMedication(m, prices))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, 30);
}

function stockStatus(med: LocalMedication): { statut: string; statutLibelle: string } {
  if (med.actif === false) return { statut: 'ARCHIVE', statutLibelle: 'Archivé' };
  if (med.stock <= 0) return { statut: 'EPUISE', statutLibelle: '🔴 Épuisé' };
  if (med.stock <= med.stockMinimal) return { statut: 'FAIBLE', statutLibelle: '🟠 Stock faible' };
  return { statut: 'NORMAL', statutLibelle: '🟢 Normal' };
}

export async function getLocalMedicationsPage(q: string, page: number, pageSize: number): Promise<any> {
  const [rows, prices] = await Promise.all([
    getAllRecords<LocalMedication>(MEDICATIONS),
    getAllRecords<LocalPriceCatalog>(CATALOG),
  ]);
  let items = rows.filter((m) => m.actif !== false);
  const term = q.trim().toLocaleLowerCase('fr');
  if (term) items = items.filter((m) => [m.code, m.nom, m.designation, m.emballage].filter(Boolean).some((v) => String(v).toLocaleLowerCase('fr').includes(term)));
  items = items.map((m) => ({ ...mergePriceIntoMedication(m, prices), ...stockStatus(m) })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return { total: items.length, page, pageSize, count: items.length, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export async function getLocalStockPage(q: string, statut: string, page: number, pageSize: number): Promise<any> {
  const [rows, prices] = await Promise.all([
    getAllRecords<LocalMedication>(MEDICATIONS),
    getAllRecords<LocalPriceCatalog>(CATALOG),
  ]);
  const term = q.trim().toLocaleLowerCase('fr');
  let items = rows.filter((m) => m.actif !== false)
    .map((m) => ({ ...mergePriceIntoMedication(m, prices), ...stockStatus(m) }))
    .filter((m) => !term || [m.code, m.nom, m.designation, m.emballage].filter(Boolean).some((v) => String(v).toLocaleLowerCase('fr').includes(term)));
  if (statut && statut !== 'TOUS') items = items.filter((m) => m.statut === statut);
  items.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  const allActive = rows.filter((m) => m.actif !== false).map((m) => ({ ...mergePriceIntoMedication(m, prices), ...stockStatus(m) }));
  const resume = {
    normal: allActive.filter((m) => m.statut === 'NORMAL').length,
    faible: allActive.filter((m) => m.statut === 'FAIBLE').length,
    epuise: allActive.filter((m) => m.statut === 'EPUISE').length,
    expirationProche: allActive.filter((m) => m.statut === 'EXPIRATION_PROCHE').length,
    expire: allActive.filter((m) => m.statut === 'EXPIRE').length,
    valeurStockAchat: allActive.reduce((sum, m) => sum + m.stock * Number(m.prixAchat || 0), 0),
    valeurStockVente: allActive.reduce((sum, m) => sum + m.stock * Number(m.prixVente || 0), 0),
  };
  return { total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize), resume };
}

export async function searchLocalCatalogue(q: string): Promise<LocalPriceCatalog[]> {
  const term = q.trim().toLocaleLowerCase('fr');
  const items = await getAllRecords<LocalPriceCatalog>(CATALOG);
  return items.filter((p) => [p.code, p.designation, p.emballage].filter(Boolean).some((v) => String(v).toLocaleLowerCase('fr').includes(term)))
    .sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0))
    .slice(0, 15);
}

export async function getLocalCataloguePage(q: string, page: number, pageSize: number): Promise<any> {
  let items = await getAllRecords<LocalPriceCatalog>(CATALOG);
  const term = q.trim().toLocaleLowerCase('fr');
  if (term) items = items.filter((p) => [p.code, p.designation, p.emballage].filter(Boolean).some((v) => String(v).toLocaleLowerCase('fr').includes(term)));
  items.sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0) || a.designation.localeCompare(b.designation, 'fr'));
  return { total: items.length, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) };
}

export async function getLocalMedication(id: number): Promise<LocalMedication | undefined> {
  const med = await getRecord<LocalMedication>(MEDICATIONS, id);
  if (!med) return undefined;
  const prices = await getAllRecords<LocalPriceCatalog>(CATALOG);
  return mergePriceIntoMedication(med, prices);
}

export async function createOfflineInvoice(input: {
  clientId: string;
  payload: any;
  user?: any;
  lines: Array<{ med: LocalMedication; qty: number }>;
}): Promise<OfflineInvoice> {
  const db = await openDb();
  const current = new Map((await getAllRecords<LocalMedication>(MEDICATIONS)).map((m) => [m.id, m]));
  const deltas = new Map<number, number>();
  const items: OfflineInvoiceItem[] = [];
  let total = 0;

  for (const line of input.lines) {
    const stored = current.get(line.med.id);
    const med = stored || normaliseMedication(line.med);
    const available = Number(med.stock);
    if (available < line.qty) throw new Error(`Stock insuffisant pour « ${med.nom} » (disponible : ${available})`);
    const price = Number(line.med.prixVente || med.prixVente || 0);
    if (price <= 0) throw new Error(`Prix non défini pour « ${med.nom} »`);
    const subtotal = Math.round(line.qty * price * 100) / 100;
    total += subtotal;
    items.push({
      medicamentId: med.id,
      designation: med.nom,
      emballage: med.emballage || null,
      quantite: line.qty,
      prixUnitaire: price,
      sousTotal: subtotal,
    });
    deltas.set(med.id, (deltas.get(med.id) || 0) - line.qty);
  }

  const remise = Number(input.payload.remise || 0);
  if (remise < 0 || remise > total) throw new Error('Remise invalide pour la facture locale');
  const netTotal = Math.round((total - remise) * 100) / 100;
  const now = new Date().toISOString();
  const invoice: OfflineInvoice = {
    id: input.clientId,
    clientId: input.clientId,
    syncId: input.clientId,
    numero: `FAC-LOCAL-${input.clientId.slice(0, 8).toUpperCase()}`,
    userId: input.user?.id,
    user: input.user,
    date: input.payload.date || now,
    createdAt: now,
    total: netTotal,
    remise,
    montantRecu: input.payload.montantRecu ?? netTotal,
    modePaiement: input.payload.modePaiement,
    statut: 'VALIDEE',
    items,
    syncStatus: 'PENDING',
    syncConflict: null,
    lastError: null,
  };
  const queue: SyncQueueRecord = {
    id: `vente:${input.clientId}`,
    entity: 'vente',
    operation: 'CREATE_VENTE',
    entityId: input.clientId,
    ownerUserId: input.user?.id,
    payload: input.payload,
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    retryable: true,
    stockDeltas: [...deltas.entries()].map(([medicamentId, delta]) => ({ medicamentId, delta })),
  };

  const tx = db.transaction([MEDICATIONS, INVOICES, QUEUE], 'readwrite');
  const medStore = tx.objectStore(MEDICATIONS);
  deltas.forEach((delta, id) => {
    const med = current.get(id) || input.lines.find((line) => line.med.id === id)?.med;
    if (!med) throw new Error(`Médicament local #${id} introuvable`);
    const previousDelta = Number(med.localStockDelta || 0);
    const serverStock = Number(med.serverStock ?? med.stock);
    const nextDelta = previousDelta + delta;
    medStore.put({ ...normaliseMedication(med, med), serverStock, localStockDelta: nextDelta, stock: serverStock + nextDelta });
  });
  tx.objectStore(INVOICES).put(invoice);
  tx.objectStore(QUEUE).put(queue);
  await txDone(tx);
  return invoice;
}

export async function createOfflineStockAdjustment(input: {
  clientId: string;
  userId?: number;
  medicament: LocalMedication;
  nouveauStock: number;
  motif: string;
}): Promise<SyncQueueRecord> {
  const db = await openDb();
  const stored = await getRecord<LocalMedication>(MEDICATIONS, input.medicament.id);
  const med = stored || input.medicament;
  const before = Number(med.stock);
  const delta = input.nouveauStock - before;
  if (delta === 0) throw new Error('Le stock est déjà à cette valeur');
  const now = new Date().toISOString();
  const queue: SyncQueueRecord = {
    id: `stock:${input.clientId}`,
    entity: 'stock',
    operation: 'ADJUST_STOCK',
    entityId: input.clientId,
    ownerUserId: input.userId,
    payload: {
      syncId: input.clientId,
      medicamentId: med.id,
      nouveauStock: input.nouveauStock,
      motif: input.motif,
    },
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: now,
    retryable: true,
    stockDeltas: [{ medicamentId: med.id, delta }],
  };
  const serverStock = Number(med.serverStock ?? med.stock);
  const currentDelta = Number(med.localStockDelta || 0);
  const tx = db.transaction([MEDICATIONS, QUEUE], 'readwrite');
  tx.objectStore(MEDICATIONS).put({ ...normaliseMedication(med, med), serverStock, localStockDelta: currentDelta + delta, stock: serverStock + currentDelta + delta });
  tx.objectStore(QUEUE).put(queue);
  await txDone(tx);
  return queue;
}

export async function getLocalInvoicesPage(filters: { q?: string; from?: string; to?: string; statut?: string }, page: number, pageSize: number): Promise<any> {
  let items = await getAllRecords<OfflineInvoice>(INVOICES);
  const term = (filters.q || '').trim().toLocaleLowerCase('fr');
  items = items.filter((invoice) => {
    if (term && ![invoice.numero, invoice.user?.username, invoice.user?.nom, invoice.user?.prenom].filter(Boolean).some((v) => String(v).toLocaleLowerCase('fr').includes(term))) return false;
    if (filters.statut && invoice.statut !== filters.statut) return false;
    if (filters.from && invoice.date.slice(0, 10) < filters.from) return false;
    if (filters.to && invoice.date.slice(0, 10) > filters.to) return false;
    return true;
  });
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalMontant = items.filter((i) => i.statut === 'VALIDEE').reduce((sum, i) => sum + Number(i.total || 0), 0);
  const mapped = items.map((i) => ({ ...i, id: i.serverId ?? i.clientId, nbItems: i.items.length }));
  return { total: mapped.length, page, pageSize, totalMontant, items: mapped.slice((page - 1) * pageSize, page * pageSize) };
}

export async function getLocalInvoice(identifier: string): Promise<OfflineInvoice | undefined> {
  const direct = await getRecord<OfflineInvoice>(INVOICES, identifier);
  if (direct) return direct;
  const all = await getAllRecords<OfflineInvoice>(INVOICES);
  return all.find((invoice) => String(invoice.serverId) === identifier || invoice.numero === identifier);
}

export async function saveServerInvoices(rows: any[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  const current = new Map((await getAllRecords<OfflineInvoice>(INVOICES)).map((invoice) => [invoice.clientId, invoice]));
  const tx = db.transaction(INVOICES, 'readwrite');
  const store = tx.objectStore(INVOICES);
  rows.forEach((row) => {
    const clientId = String(row.syncId || `server:${row.id}`);
    const previous = current.get(clientId);
    store.put({
      ...previous,
      ...row,
      id: row.id,
      clientId,
      syncId: row.syncId || clientId,
      syncStatus: 'SYNCED',
      items: row.items || previous?.items || [],
      total: Number(row.total || 0),
      remise: Number(row.remise || 0),
      montantRecu: Number(row.montantRecu || 0),
    });
  });
  await txDone(tx);
}

async function updateMedicationDeltas(tx: IDBTransaction, deltas: StockDelta[], sign: number, confirmOnServer = false): Promise<void> {
  const store = tx.objectStore(MEDICATIONS);
  for (const item of deltas) {
    const request = store.get(item.medicamentId);
    await requestResult(request as IDBRequest<LocalMedication | undefined>).then((med) => {
      if (!med) return;
      const currentDelta = Number(med.localStockDelta || 0);
      const nextDelta = currentDelta + item.delta * sign;
      const previousServerStock = Number(med.serverStock ?? med.stock);
      // A successful queue item moved the authoritative server baseline by
      // the same delta. A locally discarded item only releases its reserve.
      const serverStock = confirmOnServer ? previousServerStock + item.delta : previousServerStock;
      store.put({ ...med, serverStock, localStockDelta: nextDelta, stock: serverStock + nextDelta });
    });
  }
}

export async function markQueueSynced(queueId: string, response: any): Promise<void> {
  const db = await openDb();
  const queue = await getRecord<SyncQueueRecord>(QUEUE, queueId);
  if (!queue) return;
  const existingInvoice = queue.entity === 'vente' ? await getRecord<OfflineInvoice>(INVOICES, queue.entityId) : undefined;
  const now = new Date().toISOString();
  const tx = db.transaction([MEDICATIONS, QUEUE, INVOICES], 'readwrite');
  await updateMedicationDeltas(tx, queue.stockDeltas || [], -1, true);
  tx.objectStore(QUEUE).put({ ...queue, status: 'SYNCED', updatedAt: now, lastAttemptAt: now, lastError: null, response });
  if (existingInvoice) {
    tx.objectStore(INVOICES).put({
      ...existingInvoice,
      ...response,
      id: response?.id ?? existingInvoice.id,
      clientId: existingInvoice.clientId,
      syncId: existingInvoice.syncId,
      serverId: response?.id,
      serverNumber: response?.numero,
      numero: response?.numero || existingInvoice.numero,
      syncStatus: 'SYNCED',
      syncConflict: response?.syncConflict || null,
      lastError: null,
    });
  }
  await txDone(tx);
}

export async function markQueueFailed(queueId: string, message: string, retryable: boolean, nextAttemptAt: string): Promise<void> {
  const db = await openDb();
  const queue = await getRecord<SyncQueueRecord>(QUEUE, queueId);
  if (!queue) return;
  const invoice = queue.entity === 'vente' ? await getRecord<OfflineInvoice>(INVOICES, queue.entityId) : undefined;
  const now = new Date().toISOString();
  const tx = db.transaction([QUEUE, INVOICES], 'readwrite');
  tx.objectStore(QUEUE).put({
    ...queue,
    status: 'FAILED',
    attempts: Number(queue.attempts || 0) + 1,
    updatedAt: now,
    lastAttemptAt: now,
    lastError: message,
    retryable,
    nextAttemptAt,
  });
  if (invoice) tx.objectStore(INVOICES).put({ ...invoice, syncStatus: 'FAILED', lastError: message });
  await txDone(tx);
}

export async function retryQueue(queueId: string): Promise<void> {
  const queue = await getRecord<SyncQueueRecord>(QUEUE, queueId);
  if (!queue) return;
  await putRecord(QUEUE, { ...queue, status: 'PENDING', retryable: true, nextAttemptAt: new Date().toISOString(), lastError: null, updatedAt: new Date().toISOString() });
  if (queue.entity === 'vente') {
    const invoice = await getRecord<OfflineInvoice>(INVOICES, queue.entityId);
    if (invoice) await putRecord(INVOICES, { ...invoice, syncStatus: 'PENDING', lastError: null });
  }
}

export async function discardQueue(queueId: string): Promise<void> {
  const db = await openDb();
  const queue = await getRecord<SyncQueueRecord>(QUEUE, queueId);
  if (!queue) return;
  const invoice = queue.entity === 'vente' ? await getRecord<OfflineInvoice>(INVOICES, queue.entityId) : undefined;
  const now = new Date().toISOString();
  const tx = db.transaction([MEDICATIONS, QUEUE, INVOICES], 'readwrite');
  await updateMedicationDeltas(tx, queue.stockDeltas || [], -1);
  tx.objectStore(QUEUE).put({ ...queue, status: 'FAILED', retryable: false, lastError: 'Opération locale annulée par l’utilisateur', updatedAt: now });
  if (invoice) tx.objectStore(INVOICES).put({ ...invoice, statut: 'ANNULEE', syncStatus: 'LOCAL_CANCELLED', localDiscarded: true, motifAnnulation: 'Opération offline annulée avant synchronisation' });
  await txDone(tx);
}

export async function resetStaleSyncing(): Promise<void> {
  const rows = await getAllRecords<SyncQueueRecord>(QUEUE);
  const cutoff = Date.now() - 5 * 60 * 1000;
  await Promise.all(rows.filter((q) => q.status === 'SYNCING' && new Date(q.updatedAt).getTime() < cutoff).map((q) => putRecord(QUEUE, { ...q, status: 'PENDING', updatedAt: new Date().toISOString(), nextAttemptAt: new Date().toISOString() })));
}

export async function listQueue(): Promise<SyncQueueRecord[]> {
  const rows = await getAllRecords<SyncQueueRecord>(QUEUE);
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function getReadyQueue(): Promise<SyncQueueRecord[]> {
  const now = Date.now();
  const rows = await listQueue();
  return rows.filter((q) => (q.status === 'PENDING' || (q.status === 'FAILED' && q.retryable !== false)) && new Date(q.nextAttemptAt).getTime() <= now);
}

export async function markQueueSyncing(queueId: string): Promise<SyncQueueRecord | undefined> {
  const queue = await getRecord<SyncQueueRecord>(QUEUE, queueId);
  if (!queue) return undefined;
  const next = { ...queue, status: 'SYNCING' as const, updatedAt: new Date().toISOString() };
  await putRecord(QUEUE, next);
  return next;
}

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  const record = await getRecord<{ key: string; value: T }>(META, key);
  return record?.value;
}

export async function setMeta(key: string, value: any): Promise<void> {
  await putRecord(META, { key, value });
}

export async function getLocalUser<T = any>(): Promise<T | undefined> {
  return getMeta<T>('cachedUser');
}

export async function saveLocalUser(user: any): Promise<void> {
  // Only the non-secret profile and permission matrix are cached. Tokens and
  // passwords never enter IndexedDB.
  await setMeta('cachedUser', user);
}

export async function clearLocalUser(): Promise<void> {
  await deleteRecord(META, 'cachedUser');
}

export async function setActiveUserId(userId: number | null): Promise<void> {
  if (userId === null) await deleteRecord(META, 'activeUserId');
  else await setMeta('activeUserId', userId);
}

export async function getActiveUserId(): Promise<number | undefined> {
  return getMeta<number>('activeUserId');
}

export async function getSyncSummary(): Promise<SyncSummary> {
  if (!hasIndexedDb()) return { pending: 0, syncing: 0, failed: 0, synced: 0, total: 0, lastSyncAt: null, lastError: null, storageAvailable: false };
  const rows = await listQueue();
  return {
    pending: rows.filter((q) => q.status === 'PENDING').length,
    syncing: rows.filter((q) => q.status === 'SYNCING').length,
    failed: rows.filter((q) => q.status === 'FAILED').length,
    synced: rows.filter((q) => q.status === 'SYNCED').length,
    total: rows.length,
    lastSyncAt: (await getMeta<string>('lastSyncAt')) || null,
    lastError: (await getMeta<string>('lastSyncError')) || null,
    storageAvailable: true,
  };
}

export async function clearLocalBusinessData(): Promise<void> {
  // Explicitly not called by logout: business history must not disappear just
  // because the session ended. This is available only for a future admin wipe.
  const db = await openDb();
  const tx = db.transaction([MEDICATIONS, CATALOG, INVOICES, QUEUE, META], 'readwrite');
  [MEDICATIONS, CATALOG, INVOICES, QUEUE, META].forEach((name) => tx.objectStore(name).clear());
  await txDone(tx);
}
