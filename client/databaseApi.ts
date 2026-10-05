import { apiRequest } from './api';
import type { DatabaseQuery, DatabaseRow, DatabaseRows, DatabaseTable } from './databaseTypes';
const tablePath = (name: string) => `/api/database/tables/${encodeURIComponent(name)}`;
export function fetchDatabaseTables(signal?: AbortSignal) {
  return apiRequest<{ tables: { name: string; kind: 'table' | 'view' }[] }>('/api/database/tables', { signal, cache: 'no-store' });
}
export function fetchDatabaseSchema(name: string, signal?: AbortSignal) {
  return apiRequest<DatabaseTable>(tablePath(name), { signal, cache: 'no-store' });
}
export function fetchDatabaseRows(name: string, query: DatabaseQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== '') params.set(key, String(value));
  return apiRequest<DatabaseRows>(`${tablePath(name)}/rows?${params}`, { signal, cache: 'no-store' });
}
export function saveDatabaseRow(name: string, values: Record<string, string | null>, row: DatabaseRow | null) {
  return apiRequest(`${tablePath(name)}/rows`, {
    method: row ? 'PATCH' : 'POST',
    body: JSON.stringify(row ? { values, key: row.key, version: row.version } : { values }),
  });
}
export function deleteDatabaseRow(name: string, row: DatabaseRow) {
  return apiRequest(`${tablePath(name)}/rows`, { method: 'DELETE', body: JSON.stringify({ key: row.key, version: row.version }) });
}
