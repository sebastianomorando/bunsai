import { signal } from '@preact/signals';
import type { DatabaseQuery, DatabaseRows, DatabaseTable } from './databaseTypes';
export const databaseTablesState = signal<{ name: string; kind: 'table' | 'view' }[]>([]);
export const databaseSchemaState = signal<DatabaseTable | null>(null);
export const databaseRowsState = signal<DatabaseRows | null>(null);
export const databaseLoadingState = signal(false);
export const databaseTabState = signal<'data' | 'schema'>('data');
export const databaseQueryState = signal<DatabaseQuery>(defaultDatabaseQuery());
export function defaultDatabaseQuery(): DatabaseQuery {
  return { page: 1, limit: 20, sortBy: '', direction: 'asc', filterColumn: '', filterOperator: 'equals', filterValue: '' };
}
export function resetDatabaseState() {
  databaseTablesState.value = [];
  databaseSchemaState.value = null;
  databaseRowsState.value = null;
  databaseLoadingState.value = false;
  databaseQueryState.value = defaultDatabaseQuery();
  databaseTabState.value = 'data';
}
