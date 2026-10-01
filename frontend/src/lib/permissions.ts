// Matrice de permissions affichée dans l'UI (synchronisée avec backend/src/config.js)
export const PERMISSIONS_INFO: { module: string; label: string; ADMIN: string; FINANCE: string; ASSISTANT: string }[] = [
  { module: 'dashboard', label: 'Tableau de bord', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'read' },
  { module: 'approvisionnement', label: 'Approvisionnement', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'none' },
  { module: 'facturation', label: 'Facturation', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'full' },
  { module: 'rapportJournalier', label: 'Rapport journalier', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'full' },
  { module: 'stock', label: 'Gestion de stock', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'full' },
  { module: 'inventaire', label: 'Inventaire', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'full' },
  { module: 'finance', label: 'Finance', ADMIN: 'full', FINANCE: 'full', ASSISTANT: 'none' },
  { module: 'utilisateurs', label: 'Utilisateurs', ADMIN: 'full', FINANCE: 'none', ASSISTANT: 'none' },
  { module: 'parametres', label: 'Paramètres', ADMIN: 'full', FINANCE: 'none', ASSISTANT: 'none' },
  { module: 'rapports', label: 'Rapports & exports', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'read' },
  { module: 'audit', label: "Journal d'audit", ADMIN: 'full', FINANCE: 'none', ASSISTANT: 'none' },
  { module: 'medicaments', label: 'Médicaments (prix)', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'read' },
  { module: 'fournisseurs', label: 'Fournisseurs', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'none' },
  { module: 'catalogue', label: 'Catalogue des prix', ADMIN: 'full', FINANCE: 'read', ASSISTANT: 'read' },
];
