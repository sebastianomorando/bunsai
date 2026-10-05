import { describe, expect, test } from 'bun:test';
import { buildDatabaseSelect, quoteIdentifier, safeDatabaseError, sensitiveColumn, validateDatabaseMutation } from './databaseAdmin';
import type { DatabaseColumn, DatabaseTable } from '../client/databaseTypes';
const column = (name: string, extra: Partial<DatabaseColumn> = {}): DatabaseColumn => ({ name, type: 'text', nullable: true, defaultValue: null, generated: false, primaryKey: false, sensitive: false, editable: true, references: [], ...extra });
const table: DatabaseTable = { name: 'notes', kind: 'table', primaryKey: ['tenant', 'id'], canInsert: true, canUpdate: true, canDelete: true, protected: false, columns: [column('tenant', {primaryKey:true,editable:false}), column('id',{primaryKey:true,editable:false}), column('body'), column('token', {sensitive:true,editable:false}), column('generated',{generated:true,editable:false})] };
describe('database editor security', () => {
  test('quotes PostgreSQL identifiers and rejects invalid names', () => {
    expect(quoteIdentifier('some"name; DROP TABLE users;--')).toBe('"some""name; DROP TABLE users;--"');
    for (const value of ['', 'a\0b', 'x'.repeat(64), 'è'.repeat(32)]) expect(() => quoteIdentifier(value)).toThrow();
  });
  test('keeps filter values parameterized and never selects secrets', () => {
    const attack = "' OR true; DROP TABLE users;--";
    const { text, bindings } = buildDatabaseSelect(table, new URLSearchParams({ filterColumn: 'body', filterValue: attack }));
    expect(text).not.toContain(attack);
    expect(bindings).toContain(attack);
    expect(text).not.toContain('"token"');
    expect(text).toContain('NULL::text');
    for (const params of [{sortBy:'id; DROP TABLE users'}, {direction:'desc; DROP TABLE users'}, {filterColumn:'token'}, {sortBy:'token'}, {page:'0'}, {page:'2001'}, {limit:'51'}, {filterValue:'a'.repeat(1001)}, {filterOperator:'OR true'}]) expect(() => buildDatabaseSelect(table, new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string")))).toThrow();
  });
  test('requires full composite keys and a revision for writes', () => {
    const valid = {values:{body:'new'},key:{tenant:'1',id:'2'},version:'123'};
    expect(validateDatabaseMutation(table, valid, 'update').key).toEqual(valid.key);
    for (const input of [{...valid,key:{id:'2'}},{...valid,key:{tenant:'1',id:'2',extra:'3'}},{...valid,version:undefined},{...valid,version:"1' OR true"},{...valid,values:{}},{...valid,values:{token:'leak'}},{...valid,values:{id:'other'}},{...valid,values:{generated:'bypass'}},{...valid,values:{body:{nested:true}}},{...valid,values:{body:'a'.repeat(4097)}},{...valid,values:{body:'a\0b'}}]) expect(() => validateDatabaseMutation(table,input,'update')).toThrow();
  });
  test('enforces table and column capabilities independently of the UI', () => {
    expect(() => validateDatabaseMutation({...table,canInsert:false},{values:{}},'insert')).toThrow();
    expect(() => validateDatabaseMutation({...table,canUpdate:false},{values:{}},'update')).toThrow();
    expect(() => validateDatabaseMutation({...table,canDelete:false},{},'delete')).toThrow();
    expect(() => validateDatabaseMutation(table,{values:{token:'secret'}},'insert')).toThrow();
    expect(() => validateDatabaseMutation({...table,columns:[column('body',{nullable:false})]},{values:{body:null}},'insert')).toThrow();
  });
  test('redacts credentials and hides database diagnostics from responses and logs', () => {
    for(const name of ['password','api_token','private_key','credential','secret','key_hash','session_id','sessionId','apiKey'])expect(sensitiveColumn('new_table',name)).toBe(true);
    expect(sensitiveColumn('sessions','id')).toBe(true);
    for(const errno of ['23505','23503','22001','57014','unknown']) {
      const error = safeDatabaseError({errno,message:'password=secret',detail:'sensitive row',query:'secret SQL'}) as Error;
      expect(error.message).not.toContain('secret');
      expect(JSON.stringify(error)).not.toContain('sensitive');
    }
  });
});
