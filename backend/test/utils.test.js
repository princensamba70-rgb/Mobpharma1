import test from 'node:test';
import assert from 'node:assert/strict';
import { round2, stockStatus, toNum } from '../src/lib/utils.js';

test('les montants sont arrondis à deux décimales', () => {
  assert.equal(round2(12.345), 12.35);
  assert.equal(round2('8.1'), 8.1);
  assert.equal(toNum(null), 0);
});

test('le statut de stock conserve les règles métier', () => {
  assert.deepEqual(stockStatus({ stock: 0, stockMinimal: 5, actif: true }), ['EPUISE']);
  assert.deepEqual(stockStatus({ stock: 3, stockMinimal: 5, actif: true }), ['FAIBLE']);
  assert.deepEqual(stockStatus({ stock: 20, stockMinimal: 5, actif: true }), ['NORMAL']);
});
