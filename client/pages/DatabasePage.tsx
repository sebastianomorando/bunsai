import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { deleteDatabaseRow, fetchDatabaseRows, fetchDatabaseSchema, fetchDatabaseTables, saveDatabaseRow } from '../databaseApi';
import { databaseLoadingState, databaseQueryState, databaseRowsState, databaseSchemaState, databaseTablesState, databaseTabState, defaultDatabaseQuery, resetDatabaseState } from '../databaseState';
import type { DatabaseRow, DatabaseTable } from '../databaseTypes';
import { t } from '../i18n';
import { errorMessage, profileState, sessionState, setError, setNotice } from '../state';

function DatabaseEditor({ table, row, onClose, onSaved }: { table: DatabaseTable; row: DatabaseRow | null; onClose: () => void; onSaved: () => void }) {
  const columns = table.columns.filter(c => row ? c.editable && !row.truncated.includes(c.name) : !c.sensitive && !c.generated);
  const [fields, setFields] = useState<Record<string, { mode: string; value: string }>>(() => Object.fromEntries(columns.map(c => [c.name, {
    mode: row ? row.values[c.name] === null ? 'null' : 'value' : !c.nullable && !c.defaultValue ? 'value' : 'default', value: row?.values[c.name] ?? '',
  }])));
  const [saving, setSaving] = useState(false);
  const [error, setEditorError] = useState<string | null>(null);
  const update = (name: string, change: Partial<{ mode: string; value: string }>) => setFields(previous => ({ ...previous, [name]: { ...previous[name]!, ...change } }));
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    const values: Record<string, string | null> = Object.create(null);
    for (const column of columns) {
      const field = fields[column.name]!;
      if (field.mode === 'default') continue;
      const value = field.mode === 'null' ? null : field.value;
      if (!row || value !== row.values[column.name]) values[column.name] = value;
    }
    if (row && !Object.keys(values).length) { setEditorError(t('database.noChanges')); return; }
    setSaving(true); setEditorError(null);
    try { await saveDatabaseRow(table.name, values, row); setNotice(t('database.saved')); onSaved(); }
    catch (error) { setEditorError(errorMessage(error)); }
    finally { setSaving(false); }
  };
  return <section class="panel database-editor">
    <h3>{row ? t('database.editRecord') : t('database.addRecord')}</h3>
    <form class="database-editor-form" onSubmit={submit}>
      <fieldset disabled={saving}>
        {columns.map(column => {
          const field = fields[column.name]!;
          return <div class="database-field" key={column.name}>
            <label for={`database-value-${column.name}`}><strong>{column.name}</strong><span class="muted">{column.type}{column.primaryKey ? ' · PK' : ''}{column.references.map(f => ` → ${f.schema}.${f.table}.${f.column}`).join('')}</span></label>
            <select aria-label={`${column.name}: ${t('database.valueMode')}`} value={field.mode} onChange={event => update(column.name, { mode: event.currentTarget.value })}>
              {!row && <option value="default">{column.defaultValue ? t('database.default') : column.nullable ? 'NULL / DEFAULT' : t('database.required')}</option>}
              <option value="value">{t('database.value')}</option>
              {column.nullable && <option value="null">NULL</option>}
            </select>
            {field.mode === 'value' && (column.type === 'boolean' ? <select id={`database-value-${column.name}`} value={field.value} required onChange={event => update(column.name, { value: event.currentTarget.value })}><option value="">{t('database.choose')}</option><option value="true">true</option><option value="false">false</option></select> : <textarea id={`database-value-${column.name}`} value={field.value} maxLength={4096} rows={column.type.includes('json') || field.value.length > 100 ? 4 : 1} onInput={event => update(column.name, { value: event.currentTarget.value })} spellcheck={false} />)}
            {!row && column.type === 'uuid' && field.mode === 'value' && <button type="button" class="linklike" onClick={() => update(column.name, { value: crypto.randomUUID() })}>{t('database.generateUuid')}</button>}
          </div>;
        })}
      </fieldset>
      {error && <p class="banner error" role="alert">{error}</p>}
      <div class="rowactions"><button class="button" type="submit" disabled={saving}>{saving ? t('database.saving') : t('database.save')}</button><button type="button" class="button ghost" disabled={saving} onClick={onClose}>{t('database.cancel')}</button></div>
    </form>
  </section>;
}

export function DatabasePage({ table: tableParam }: { table?: string }) {
  const { route } = useLocation();
  const tableName = tableParam ?? '';
  const isAdmin = Boolean(sessionState.value && profileState.value?.role === 'admin' && profileState.value.isActive);
  const [tableSearch, setTableSearch] = useState('');
  const [editor, setEditor] = useState<{ table: string; row: DatabaseRow | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DatabaseRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const query = databaseQueryState.value;
  const [filterColumn, setFilterColumn] = useState('');
  const [filterOperator, setFilterOperator] = useState<'equals' | 'contains' | 'null' | 'notnull'>('equals');
  const [filterValue, setFilterValue] = useState('');
  const loadedTable = useRef<string | null>(null);

  useEffect(() => {
    setEditor(null); setDeleteTarget(null);
    if (!isAdmin) { resetDatabaseState(); return; }
    const controller = new AbortController();
    void fetchDatabaseTables(controller.signal).then(data => {
      if (!controller.signal.aborted) databaseTablesState.value = data.tables;
    }).catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    return () => { controller.abort(); resetDatabaseState(); };
  }, [isAdmin, sessionState.value?.userId]);

  useEffect(() => {
    if (!isAdmin || !tableName) { loadedTable.current = null; return; }
    if (loadedTable.current !== tableName) {
      loadedTable.current = tableName;
      setEditor(null); setDeleteTarget(null);
      setFilterColumn(''); setFilterValue(''); setFilterOperator('equals');
      databaseSchemaState.value = null;
      databaseRowsState.value = null;
      databaseLoadingState.value = true;
      databaseQueryState.value = defaultDatabaseQuery();
      return;
    }
    const controller = new AbortController();
    databaseLoadingState.value = true;
    databaseRowsState.value = null;
    void Promise.all([fetchDatabaseSchema(tableName, controller.signal), fetchDatabaseRows(tableName, query, controller.signal)]).then(([schema, rows]) => {
      if (controller.signal.aborted) return;
      databaseSchemaState.value = schema;
      databaseRowsState.value = rows;
    }).catch(error => { if (!controller.signal.aborted) { databaseSchemaState.value = null; setError(errorMessage(error)); } })
      .finally(() => { if (!controller.signal.aborted) databaseLoadingState.value = false; });
    return () => controller.abort();
  }, [isAdmin, sessionState.value?.userId, tableName, query, refresh]);

  if (!isAdmin) return <section class="panel"><h2>{t('database.adminOnly')}</h2><p>{t('database.adminOnlyHint')}</p></section>;
  const schema = databaseSchemaState.value;
  const data = databaseRowsState.value;
  const safeColumns = schema?.columns.filter(c => !c.sensitive) ?? [];
  const reload = () => { setEditor(null); setDeleteTarget(null); setRefresh(value => value + 1); };
  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await deleteDatabaseRow(tableName, deleteTarget); setNotice(t('database.deleted')); reload(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setDeleting(false); }
  };
  return <div class="database-page">
    <div class="row"><div><h2>{t('database.title')}</h2><p class="muted">PostgreSQL · public</p></div><button class="button ghost" disabled={databaseLoadingState.value || deleting} onClick={reload}>{t('database.refresh')}</button></div>
    <div class="database-layout">
      <aside class="panel database-sidebar"><h3>{t('database.tables')}</h3><input type="search" aria-label={t('database.findTable')} placeholder={t('database.findTable')} value={tableSearch} onInput={event => setTableSearch(event.currentTarget.value)} /><nav aria-label={t('database.tables')}>
        {databaseTablesState.value.filter(table => table.name.toLowerCase().includes(tableSearch.toLowerCase())).map(table => <a href={`/database/${encodeURIComponent(table.name)}`} key={table.name} aria-current={tableName === table.name ? 'page' : undefined} onClick={event => { event.preventDefault(); if (!deleting) route(`/database/${encodeURIComponent(table.name)}`); }}><span>{table.name}</span>{table.kind === 'view' && <small>{t('database.view')}</small>}</a>)}
      </nav></aside>
      <div class="database-main">
        {!tableName ? <section class="panel"><h3>{t('database.chooseTable')}</h3><p>{t('database.chooseTableHint')}</p></section> : <>
          <section class="panel database-data-panel"><div class="row"><h3 class="database-table-name">{tableName}</h3><div class="database-tabs"><button type="button" class={`button ${databaseTabState.value === 'data' ? '' : 'ghost'}`} aria-pressed={databaseTabState.value === 'data'} onClick={() => databaseTabState.value = 'data'}>{t('database.data')}</button><button type="button" class={`button ${databaseTabState.value === 'schema' ? '' : 'ghost'}`} aria-pressed={databaseTabState.value === 'schema'} onClick={() => databaseTabState.value = 'schema'}>{t('database.structure')}</button></div></div>
            {schema?.protected && <p class="muted">{t('database.protectedHint')}</p>}
            {schema && !schema.primaryKey.length && <p class="muted">{t('database.noPrimaryKey')}</p>}
            {databaseLoadingState.value ? <p role="status">{t('database.loading')}</p> : !schema || !data ? <p>{t('database.loadError')}</p> : databaseTabState.value === 'schema' ? <div class="database-table-scroll" tabIndex={0} role="region" aria-label={t('database.structure')}><table class="database-grid"><thead><tr><th>{t('database.column')}</th><th>{t('database.type')}</th><th>NULL</th><th>{t('database.default')}</th><th>{t('database.constraints')}</th></tr></thead><tbody>{schema.columns.map(c => <tr key={c.name}><th scope="row">{c.name}</th><td>{c.type}</td><td>{c.nullable ? '✓' : '—'}</td><td>{c.defaultValue ?? '—'}</td><td>{[c.primaryKey ? 'PK' : '', c.generated ? t('database.generated') : '', c.sensitive ? t('database.hidden') : '', ...c.references.map(f => `→ ${f.schema}.${f.table}.${f.column}`)].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table></div> : <>
              <form class="database-toolbar" onSubmit={event => { event.preventDefault(); databaseQueryState.value = { ...query, page: 1, filterColumn, filterOperator, filterValue }; }}>
                <label>{t('database.filter')}<select value={filterColumn} onChange={event => setFilterColumn(event.currentTarget.value)}><option value="">{t('database.allRows')}</option>{safeColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label>
                <label>{t('database.operator')}<select disabled={!filterColumn} value={filterOperator} onChange={event => setFilterOperator(event.currentTarget.value as typeof filterOperator)}><option value="equals">=</option><option value="contains">{t('database.contains')}</option><option value="null">IS NULL</option><option value="notnull">IS NOT NULL</option></select></label>
                <label>{t('database.value')}<input value={filterValue} disabled={!filterColumn || ['null', 'notnull'].includes(filterOperator)} maxLength={1000} onInput={event => setFilterValue(event.currentTarget.value)} /></label><button type="submit" class="button ghost">{t('database.apply')}</button>
              </form>
              <div class="database-toolbar"><label>{t('database.sort')}<select value={data.sortBy} onChange={event => databaseQueryState.value = { ...query, page: 1, sortBy: event.currentTarget.value }}>{safeColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label><label>{t('database.direction')}<select value={query.direction} onChange={event => databaseQueryState.value = { ...query, page: 1, direction: event.currentTarget.value as 'asc' | 'desc' }}><option value="asc">ASC</option><option value="desc">DESC</option></select></label>{schema.canInsert && <button type="button" class="button" onClick={() => { setDeleteTarget(null); setEditor({ table: tableName, row: null }); }}>{t('database.addRecord')}</button>}</div>
              <div class="database-table-scroll" tabIndex={0} role="region" aria-label={t('database.data')}><table class="database-grid"><thead><tr>{schema.columns.map(c => <th key={c.name} scope="col">{c.name}{c.primaryKey ? ' · PK' : ''}</th>)}{(schema.canUpdate || schema.canDelete) && <th scope="col">{t('database.actions')}</th>}</tr></thead><tbody>{data.rows.map((row, index) => <tr key={index}>{schema.columns.map(c => <td key={c.name}>{c.sensitive ? <span class="muted">{t('database.hidden')}</span> : row.values[c.name] === null ? <span class="database-null">NULL</span> : <span class="database-cell" title={row.values[c.name] ?? ''}>{row.values[c.name]}{row.truncated.includes(c.name) ? '…' : ''}</span>}</td>)}{(schema.canUpdate || schema.canDelete) && <td><div class="rowactions">{schema.canUpdate && <button type="button" class="button ghost" disabled={!row.key || deleting} onClick={() => { setDeleteTarget(null); setEditor({ table: tableName, row }); }}>{t('database.edit')}</button>}{schema.canDelete && <button type="button" class="button danger" disabled={!row.key || deleting} onClick={() => { setEditor(null); setDeleteTarget(row); }}>{t('database.delete')}</button>}</div></td>}</tr>)}</tbody></table></div>
              {!data.rows.length && <p>{t('database.empty')}</p>}
              <div class="pagination"><button type="button" class="button ghost" disabled={data.page <= 1 || deleting} onClick={() => databaseQueryState.value = { ...query, page: data.page - 1 }}>{t('database.previous')}</button><span>{t('database.page', { page: data.page })}</span><button type="button" class="button ghost" disabled={!data.hasMore || data.page >= 2000 || deleting} onClick={() => databaseQueryState.value = { ...query, page: data.page + 1 }}>{t('database.next')}</button><label class="limitcontrol">{t('database.perPage')}<select value={String(query.limit)} onChange={event => databaseQueryState.value = { ...query, page: 1, limit: Number(event.currentTarget.value) }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label></div>
              <p class="muted">{t('database.limitHint', { limit: data.limit })}</p>
            </>}
          </section>
          {editor?.table === tableName && schema && <DatabaseEditor key={`${tableName}:${editor.row ? JSON.stringify(editor.row.key) : 'new'}`} table={schema} row={editor.row} onClose={() => setEditor(null)} onSaved={reload} />}
          {deleteTarget && <section class="panel database-delete" role="alert"><h3>{t('database.deleteRecord')}</h3><p>{t('database.deleteHint')}</p><pre>{JSON.stringify(deleteTarget.key, null, 2)}</pre><div class="rowactions"><button type="button" class="button danger" disabled={deleting} onClick={() => void remove()}>{deleting ? t('database.saving') : t('database.confirmDelete')}</button><button type="button" class="button ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>{t('database.cancel')}</button></div></section>}
        </>}
      </div>
    </div>
  </div>;
}
