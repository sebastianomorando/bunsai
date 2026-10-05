import { sql, type SQL } from 'bun';
import { requireActiveAdmin } from './adminAuth';
import type { Bundana } from '../lib/Bundana';
import type { DatabaseColumn, DatabaseRow, DatabaseRows, DatabaseTable } from '../client/databaseTypes';
import { ConflictError, errorToResponse, HttpError, NotAuthorizedError, NotFoundError, ValidationError } from './errors';
import { enforceRequestRateLimit } from './rateLimit';
import { readSetupInput, validateSetupOrigin } from './setup';

const CELL_LIMIT = 4096;
const MAX_COLUMNS = 128;
const MAX_PAGE = 2000;
const protectedTables = new Set(['users', 'assets', 'sessions', 'password_resets', 'rate_limits', 'app_setup', 'migrations', 'user_invitations']);
// Match secrets even in newly added application tables. They are never selected,
// filtered or ordered, and cannot be written through the generic editor.
export function sensitiveColumn(table: string, name: string): boolean {
  return /password|passwd|secret|token|credential|private_?key|api_?key|key_hash|session_?(id|key)/i.test(name)
    || (table === 'sessions' && name === 'id');
}
export function quoteIdentifier(name: string): string {
  if (!name || new TextEncoder().encode(name).length > 63 || name.includes('\0')) throw new ValidationError('Identificatore non valido');
  return `"${name.replaceAll('"', '""')}"`;
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
const tableSql = (name: string) => `"public".${quoteIdentifier(name)}`;

export const requireDatabaseAdmin = requireActiveAdmin;

let activeQueries = 0;
async function databaseTask<T>(run: (tx: SQL) => Promise<T>): Promise<T> {
  if (activeQueries >= 4) throw new HttpError(503, 'Database occupato, riprova tra poco', { code: 'DATABASE_BUSY' });
  activeQueries++;
  try {
    return await sql.begin(async tx => {
      await tx`SET LOCAL statement_timeout = '3s'`;
      await tx`SET LOCAL lock_timeout = '1s'`;
      return run(tx);
    });
  } finally { activeQueries--; }
}

export async function listDatabaseTables(tx: SQL): Promise<{ name: string; kind: 'table' | 'view' }[]> {
  const rows = await tx`
    SELECT c.relname AS name, CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END AS kind
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      AND NOT c.relispartition AND has_table_privilege(c.oid, 'SELECT')
    ORDER BY c.relname LIMIT 501
  `;
  if (rows.length > 500) throw new ValidationError('Troppe tabelle per il pannello database');
  return rows as { name: string; kind: 'table' | 'view' }[];
}

export async function describeDatabaseTable(tx: SQL, name: string): Promise<DatabaseTable> {
  quoteIdentifier(name);
  const tables = await listDatabaseTables(tx);
  const table = tables.find(t => t.name === name);
  if (!table) throw new NotFoundError('Tabella non disponibile');
  const columns: { name: string; type: string; nullable: boolean; default_value: string | null; generated: boolean; primary_key: boolean }[] = await tx`
    SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
      NOT a.attnotnull AS nullable, pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_value,
      a.attgenerated <> '' OR a.attidentity = 'a' AS generated,
      EXISTS (SELECT 1 FROM pg_catalog.pg_constraint p WHERE p.conrelid = a.attrelid
        AND p.contype = 'p' AND a.attnum = ANY(p.conkey)) AS primary_key
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname = ${name} AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 129
  `;
  if (columns.length > MAX_COLUMNS) throw new ValidationError('Tabella con troppe colonne per il pannello database');
  const foreignKeys: { column_name: string; foreign_schema: string; foreign_table: string; foreign_column: string }[] = await tx`
    SELECT a.attname AS column_name, fn.nspname AS foreign_schema, fc.relname AS foreign_table, fa.attname AS foreign_column
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_class fc ON fc.oid = k.confrelid
    JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
    CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS keys(local_key, foreign_key)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = keys.local_key
    JOIN pg_catalog.pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = keys.foreign_key
    WHERE k.contype = 'f' AND n.nspname = 'public' AND c.relname = ${name}
  `;
  const primaryKey = columns.filter(c => c.primary_key).map(c => String(c.name));
  const protectedTable = protectedTables.has(name);
  const blockedKey = columns.some(c => c.primary_key && sensitiveColumn(name, String(c.name)));
  const descriptors: DatabaseColumn[] = columns.map(c => {
    const columnName = String(c.name);
    const sensitive = sensitiveColumn(name, columnName);
    // Users and assets have dedicated lifecycle APIs; only safe display fields
    // may be changed here. Internal security/control tables are read-only.
    const safeProtectedField = (name === 'users' && columnName === 'username') || (name === 'assets' && columnName === 'title');
    return {
      name: columnName, type: String(c.type), nullable: Boolean(c.nullable),
      defaultValue: sensitive ? null : c.default_value ?? null,
      generated: Boolean(c.generated), primaryKey: Boolean(c.primary_key), sensitive,
      editable: table.kind === 'table' && !sensitive && !c.generated && !c.primary_key && (!protectedTable || safeProtectedField),
      references: foreignKeys.filter(f => f.column_name === columnName).map(f => ({ schema: String(f.foreign_schema), table: String(f.foreign_table), column: String(f.foreign_column) })),
    };
  });
  return { ...table, columns: descriptors, primaryKey, protected: protectedTable,
    canInsert: table.kind === 'table' && !protectedTable && !blockedKey,
    canUpdate: table.kind === 'table' && primaryKey.length > 0 && !blockedKey && descriptors.some(c => c.editable),
    canDelete: table.kind === 'table' && primaryKey.length > 0 && !blockedKey && !protectedTable,
  };
}

export function parseDatabaseQuery(table: DatabaseTable, params: URLSearchParams) {
  const integer = (name: string, fallback: number, max: number) => {
    const value = params.get(name);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) throw new ValidationError('Paginazione non valida');
    return Number(value);
  };
  const page = integer('page', 1, MAX_PAGE);
  // Bound results by cell length as well as row count (~1M characters/page).
  const maxLimit = Math.max(1, Math.min(50, Math.floor(1_048_576 / (Math.max(1, table.columns.length) * (CELL_LIMIT + 1)))));
  const limit = Math.min(integer('limit', 20, 50), maxLimit);
  const visible = table.columns.filter(c => !c.sensitive);
  const sortBy = params.get('sortBy') || table.primaryKey.find(key => visible.some(c => c.name === key)) || visible[0]?.name || '';
  if (sortBy && !visible.some(c => c.name === sortBy)) throw new ValidationError('Colonna di ordinamento non valida');
  const direction = params.get('direction') || 'asc';
  if (direction !== 'asc' && direction !== 'desc') throw new ValidationError('Direzione non valida');
  const filterColumn = params.get('filterColumn') || '';
  const operator = params.get('filterOperator') || 'equals';
  const filterValue = params.get('filterValue') || '';
  if (filterColumn && !visible.some(c => c.name === filterColumn)) throw new ValidationError('Colonna di filtro non valida');
  if (!['equals', 'contains', 'null', 'notnull'].includes(operator) || filterValue.length > 1000) throw new ValidationError('Filtro non valido');
  return { page, limit, sortBy, direction: direction as 'asc' | 'desc', filterColumn, operator, filterValue };
}

export function buildDatabaseSelect(table: DatabaseTable, params: URLSearchParams) {
  const query = parseDatabaseQuery(table, params);
  const bindings: unknown[] = [];
  const bind = (value: unknown) => { bindings.push(value); return `$${bindings.length}`; };
  const cells = table.columns.map((c, i) => c.sensitive ? `NULL::text AS "c${i}"` : `left(${quoteIdentifier(c.name)}::text, ${CELL_LIMIT + 1}) AS "c${i}"`);
  let where = '';
  if (query.filterColumn) {
    const column = quoteIdentifier(query.filterColumn);
    if (query.operator === 'null' || query.operator === 'notnull') where = ` WHERE ${column} IS ${query.operator === 'notnull' ? 'NOT ' : ''}NULL`;
    else if (query.operator === 'contains') where = ` WHERE strpos(${column}::text, ${bind(query.filterValue)}) > 0`;
    else {
      const type = table.columns.find(c => c.name === query.filterColumn)?.type;
      where = type === 'json' || type === 'jsonb'
        ? ` WHERE ${column}::jsonb = ${bind(query.filterValue)}::text::jsonb`
        : ` WHERE ${column} = ${bind(query.filterValue)}`;
    }
  }
  const order = query.sortBy ? ` ORDER BY ${quoteIdentifier(query.sortBy)} ${query.direction.toUpperCase()}${table.primaryKey.filter(k => k !== query.sortBy && !sensitiveColumn(table.name, k)).map(k => `, ${quoteIdentifier(k)} ASC`).join('')}` : '';
  const version = table.kind === 'table' ? 'xmin::text' : 'NULL::text';
  return { query, bindings, text: `SELECT ${cells.join(', ')}, ${version} AS "__version" FROM ${tableSql(table.name)}${where}${order} LIMIT ${bind(query.limit + 1)} OFFSET ${bind((query.page - 1) * query.limit)}` };
}

export async function readDatabaseRows(tx: SQL, table: DatabaseTable, params: URLSearchParams): Promise<DatabaseRows> {
  const { text, bindings, query } = buildDatabaseSelect(table, params);
  const data = await tx.unsafe(text, bindings);
  const rows: DatabaseRow[] = data.slice(0, query.limit).map((raw: Record<string, unknown>) => {
    const values: Record<string, string | null> = Object.create(null);
    const truncated: string[] = [];
    for (const [index, c] of table.columns.entries()) {
      const value = raw[`c${index}`];
      values[c.name] = value === null ? null : String(value).slice(0, CELL_LIMIT);
      if (value !== null && String(value).length > CELL_LIMIT) truncated.push(c.name);
    }
    const hasKey = table.primaryKey.length > 0 && table.primaryKey.every(k => !sensitiveColumn(table.name, k) && values[k] !== null && !truncated.includes(k));
    return { values, truncated, key: hasKey ? Object.fromEntries(table.primaryKey.map(k => [k, values[k]!])) : null, version: raw.__version === null ? null : String(raw.__version) };
  });
  return { rows, page: query.page, limit: query.limit, hasMore: data.length > query.limit, sortBy: query.sortBy, direction: query.direction };
}

export function validateDatabaseMutation(table: DatabaseTable, input: unknown, operation: 'insert' | 'update' | 'delete') {
  if (!record(input)) throw new ValidationError('Dati non validi');
  if (!(operation === 'insert' ? table.canInsert : operation === 'update' ? table.canUpdate : table.canDelete)) throw new NotAuthorizedError('Operazione non consentita su questa tabella');
  if (Object.keys(input).some(k => !['values', 'key', 'version'].includes(k))) throw new ValidationError('Dati non validi');
  const values = input.values ?? {};
  if (!record(values) || Object.keys(values).length > MAX_COLUMNS) throw new ValidationError('Valori non validi');
  for (const [name, value] of Object.entries(values)) {
    const column = table.columns.find(c => c.name === name);
    if (!column || column.sensitive || column.generated || (operation === 'update' && !column.editable) || operation === 'delete') throw new ValidationError('Colonna non modificabile');
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw new ValidationError('Usa valori scalari o testo JSON');
    if (value === null && !column.nullable) throw new ValidationError('La colonna non accetta NULL');
    if (typeof value === 'string' && (value.length > CELL_LIMIT || value.includes('\0'))) throw new ValidationError('Valore troppo lungo o non valido');
    if (table.name === 'users' && name === 'username' && (typeof value !== 'string' || value.trim() !== value || value.length < 3 || value.length > 255 || /[\x00-\x1f\x7f]/.test(value))) throw new ValidationError('Username non valido');
    if (table.name === 'assets' && name === 'title' && typeof value === 'string' && value.length > 255) throw new ValidationError('Titolo troppo lungo');
  }
  if (operation === 'update' && !Object.keys(values).length) throw new ValidationError('Nessuna modifica');
  let key: Record<string, string> = {};
  let version: string | undefined;
  if (operation !== 'insert') {
    if (!record(input.key) || Object.keys(input.key).length !== table.primaryKey.length || !table.primaryKey.length) throw new ValidationError('Chiave primaria richiesta');
    for (const column of table.primaryKey) {
      const value = input.key[column];
      if (typeof value !== 'string' || value.length > CELL_LIMIT || value.includes('\0')) throw new ValidationError('Chiave primaria non valida');
    }
    key = input.key as Record<string, string>;
    if (typeof input.version !== 'string' || !/^\d{1,10}$/.test(input.version)) throw new ValidationError('Versione del record richiesta');
    version = input.version;
  }
  return { values, key, version };
}

export async function mutateDatabaseRow(tx: SQL, table: DatabaseTable, input: unknown, operation: 'insert' | 'update' | 'delete') {
  const { values, key, version } = validateDatabaseMutation(table, input, operation);
  const bindings: unknown[] = [];
  const bind = (value: unknown) => { bindings.push(value); return `$${bindings.length}`; };
  const names = Object.keys(values);
  const bindColumn = (name: string) => {
    const placeholder = bind(values[name]);
    const type = table.columns.find(c => c.name === name)?.type;
    // Force text parameter encoding before PostgreSQL parses JSON. Otherwise
    // Bun serializes a string for a jsonb parameter as a JSON string literal.
    return values[name] !== null && (type === 'json' || type === 'jsonb') ? `${placeholder}::text::${type}` : placeholder;
  };
  let text: string;
  if (operation === 'insert') text = `INSERT INTO ${tableSql(table.name)}${names.length ? ` (${names.map(quoteIdentifier).join(', ')}) VALUES (${names.map(bindColumn).join(', ')})` : ' DEFAULT VALUES'} RETURNING 1`;
  else {
    const touchTimestamp = operation === 'update' && ['users', 'assets'].includes(table.name) && table.columns.some(c => c.name === 'date_updated');
    const set = operation === 'update' ? [...names.map(n => `${quoteIdentifier(n)} = ${bindColumn(n)}`), ...(touchTimestamp ? ['"date_updated" = now()'] : [])].join(', ') : '';
    const where = table.primaryKey.map(k => `${quoteIdentifier(k)} = ${bind(key[k])}`).join(' AND ') + ` AND xmin::text = ${bind(version)}`;
    text = `${operation === 'update' ? `UPDATE ${tableSql(table.name)} SET ${set}` : `DELETE FROM ${tableSql(table.name)}`} WHERE ${where} RETURNING 1`;
  }
  const rows = await tx.unsafe(text, bindings);
  if (rows.length !== 1) throw new ConflictError('Il record è cambiato o è stato eliminato. Ricarica i dati.', { code: 'DATABASE_STALE_ROW' });
  return { saved: true };
}

export function safeDatabaseError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  const code = (error as { errno?: string; code?: string })?.errno ?? (error as { code?: string })?.code;
  if (code === '23505') return new ConflictError('Un record con questi valori esiste già', { code: 'DATABASE_CONSTRAINT' });
  if (code === '23503' || code === '23502' || code === '23514' || code?.startsWith('22')) return new ValidationError('Valori non validi o vincoli della tabella non rispettati', { code: 'DATABASE_CONSTRAINT' });
  if (code === '57014' || code === '55P03' || code === '40001' || code === '40P01') return new ConflictError('Operazione occupata o troppo lenta, riprova', { code: 'DATABASE_BUSY' });
  // PostgreSQL error details can contain complete rows and credentials.
  return new HttpError(500, 'Operazione database non riuscita', { code: 'DATABASE_ERROR' });
}

export function registerDatabaseAdmin(app: Bundana<unknown>) {
  const handle = (operation: 'tables' | 'schema' | 'rows' | 'insert' | 'update' | 'delete') => async (req: Bun.BunRequest, server: Bun.Server<unknown>) => {
    try {
      await requireDatabaseAdmin(req);
      const writing = ['insert', 'update', 'delete'].includes(operation);
      if (writing) validateSetupOrigin(req);
      else if (req.headers.get('sec-fetch-site') === 'cross-site') throw new NotAuthorizedError();
      await enforceRequestRateLimit(writing ? 'databaseWrite' : 'databaseRead', req, server);
      const tableName = (req as Bun.BunRequest & { params: { table?: string } }).params?.table ?? '';
      const input = writing ? await readSetupInput(req) : undefined;
      const result = await databaseTask(async tx => {
        if (operation === 'tables') return { tables: await listDatabaseTables(tx) };
        const table = await describeDatabaseTable(tx, tableName);
        if (operation === 'schema') return table;
        if (operation === 'rows') return readDatabaseRows(tx, table, new URL(req.url).searchParams);
        return mutateDatabaseRow(tx, table, input, operation as 'insert' | 'update' | 'delete');
      });
      return Response.json(result, { status: operation === 'insert' ? 201 : 200, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (error) {
      const response = errorToResponse(safeDatabaseError(error));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
  };
  app.get('/api/database/tables', handle('tables'));
  app.get('/api/database/tables/:table', handle('schema'));
  app.get('/api/database/tables/:table/rows', handle('rows'));
  app.post('/api/database/tables/:table/rows', handle('insert'));
  app.patch('/api/database/tables/:table/rows', handle('update'));
  app.delete('/api/database/tables/:table/rows', handle('delete'));
}
