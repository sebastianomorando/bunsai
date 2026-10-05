import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'bun';
const enabled = process.env.DATABASE_ADMIN_INTEGRATION === '1';
let server: Bun.Server<unknown>;
let origin: string;
let adminCookie: string;
let userCookie: string;
let inactiveCookie: string;
let adminId: string;

describe.skipIf(!enabled)('PostgreSQL database manager', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL ?? '').pathname !== '/bunsai_database_tests' || process.env.NODE_ENV === 'production') throw new Error('Use only the disposable bunsai_database_tests database');
    const { Bundana } = await import('../lib/Bundana');
    const { registerDatabaseAdmin } = await import('./databaseAdmin');
    const { default: Session } = await import('../entities/Session');
    const app = new Bundana(); registerDatabaseAdmin(app);
    server = app.listen({hostname:'127.0.0.1',port:0});
    origin = `http://127.0.0.1:${server.port}`; process.env.APP_URL = origin;
    for (const [role, active] of [['admin',true], ['user',true], ['admin',false]] as const) {
      const id = Bun.randomUUIDv7();
      await sql`INSERT INTO users (id,username,email,password,role,is_active,api_token) VALUES (${id},${id},${id+'@example.test'},'hash-must-stay-secret',${role},${active},${id})`;
      const session = await Session.initNewSession(id);
      if (role === 'user') userCookie = `session_id=${session.id}`;
      else if (!active) inactiveCookie = `session_id=${session.id}`;
      else { adminCookie = `session_id=${session.id}`; adminId = id; }
    }
    await sql.unsafe(`CREATE TABLE editor_tenants (id integer PRIMARY KEY, name text NOT NULL); INSERT INTO editor_tenants VALUES (1,'one');
      CREATE TABLE editor_records (tenant integer REFERENCES editor_tenants(id), id text, name varchar(255) NOT NULL, note text DEFAULT 'untouched', enabled boolean DEFAULT false, payload jsonb DEFAULT '{}', big_number bigint DEFAULT 9007199254740993, created_at timestamptz DEFAULT now(), password text DEFAULT 'fixture-password-secret', PRIMARY KEY(tenant,id));
      CREATE TABLE editor_no_key (name text); INSERT INTO editor_no_key VALUES ('plain');
      CREATE VIEW editor_view AS SELECT name FROM editor_no_key;
      CREATE VIEW editor_slow AS SELECT 1::integer AS value FROM pg_sleep(10);`);
  });
  const request = (path: string, method = 'GET', body?: unknown, cookie = adminCookie, requestOrigin = origin) => fetch(origin+'/api/database/tables'+path,{method,headers:{Cookie:cookie, Origin:requestOrigin,...(body === undefined ? {} : {'Content-Type':'application/json'})},body: body === undefined ? undefined : JSON.stringify(body)});
  const rows = async () => (await (await request('/editor_records/rows')).json()).rows;
  test('requires a current active administrator on every endpoint',async()=>{
    for(const cookie of ['',userCookie,inactiveCookie]) {
      for(const [path,method,body] of [['','GET',undefined],['/users','GET',undefined],['/users/rows','GET',undefined],['/editor_records/rows','POST',{values:{}}],['/editor_records/rows','PATCH',{}],['/editor_records/rows','DELETE',{}]] as const) expect((await request(path,method,body,cookie)).status).toBe(cookie ? 403 : 401);
    }
    await sql`UPDATE users SET role = 'user' WHERE id = ${adminId}`;
    expect((await request('')).status).toBe(403);
    await sql`UPDATE users SET role = 'admin' WHERE id = ${adminId}`;
    const expired = Bun.randomUUIDv7();
    await sql`INSERT INTO sessions (id,user_id,expires_at) VALUES (${expired},${adminId},${new Date(0)})`;
    expect((await request('', 'GET',undefined,`session_id=${expired}`)).status).toBe(401);
  });
  test('describes PostgreSQL primary keys, defaults, relations and read-only views',async()=>{
    const list=await request('');expect(list.status).toBe(200); expect(list.headers.get('Cache-Control')).toBe('no-store');
    expect((await list.json()).tables.some((t:{name:string})=>t.name==='editor_records')).toBe(true);
    const schema=await (await request('/editor_records')).json();
    expect(schema.primaryKey).toEqual(['tenant','id']);
    expect(schema.columns.find((c:{name:string})=>c.name==='tenant').references).toEqual([{schema:'public',table:'editor_tenants',column:'id'}]);
    expect(schema.columns.find((c:{name:string})=>c.name==='password').defaultValue).toBeNull();
    expect((await (await request('/editor_view')).json()).canUpdate).toBe(false);
    expect((await (await request('/editor_no_key')).json()).canDelete).toBe(false);
    expect((await request('/pg_authid')).status).toBe(404);
    expect((await request('/'+encodeURIComponent('users; DROP TABLE users;--'))).status).toBe(404);
  });
  test('blocks CSRF and oversized writes before mutations',async()=>{
    expect((await request('/editor_records/rows','POST',{values:{}},adminCookie,'https://attacker.example')).status).toBe(403);
    const response=await fetch(origin+'/api/database/tables/editor_records/rows',{method:'POST',headers:{Cookie:adminCookie,Origin:origin,'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'},body:'{}'});
    expect(response.status).toBe(403);
    expect((await request('/editor_records/rows','POST',{values:{name:'a'.repeat(9000)}})).status).toBe(400);
  });
  test('inserts records with defaults, preserves types, NULL and empty strings',async()=>{
    const response=await request('/editor_records/rows','POST',{values:{tenant:'1',id:"record' OR true--",name:'<img src=x onerror=alert(1)>',note:null,payload:'{"nested":true}'}});
    expect(response.status).toBe(201);
    const [row]=await rows();
    expect(row.values.note).toBeNull(); expect(row.values.enabled).toBe('false');expect(row.values.big_number).toBe('9007199254740993');
    expect(JSON.parse(row.values.payload)).toEqual({nested:true}); expect(row.values.password).toBeNull();
    const jsonFiltered=await (await request('/editor_records/rows?filterColumn=payload&filterValue='+encodeURIComponent('{"nested":true}'))).json();expect(jsonFiltered.rows.length).toBe(1);
    const filtered=await (await request('/editor_records/rows?filterColumn=name&filterOperator=contains&filterValue='+encodeURIComponent('<img'))).json(); expect(filtered.rows.length).toBe(1);
    const attack=await (await request('/editor_records/rows?filterColumn=name&filterValue='+encodeURIComponent("' OR true--"))).json();expect(attack.rows.length).toBe(0);
    expect((await request('/editor_records/rows?filterColumn=password&filterValue=fixture-password-secret')).status).toBe(422);
    expect((await request('/editor_records/rows?sortBy='+encodeURIComponent('name; DROP TABLE users;--'))).status).toBe(422);
    expect((await request('/editor_records/rows','PATCH',{key:row.key,version:row.version,values:{note:'',big_number:'9007199254740995',payload:'[1,{"changed":true}]',created_at:'2026-10-05T12:00:00Z'}})).status).toBe(200);
    expect((await rows())[0].values.note).toBe('');
    expect((await rows())[0].values.big_number).toBe('9007199254740995');
    expect(JSON.parse((await rows())[0].values.payload)).toEqual([1,{changed:true}]);
  });
  test('prevents lost updates, incomplete keys, secret edits and lifecycle bypasses',async()=>{
    const [row]=await rows();
    const result=await Promise.all(['first','second'].map(note=>request('/editor_records/rows','PATCH',{key:row.key,version:row.version,values:{note}})));
    expect(result.map(r=>r.status).sort()).toEqual([200,409]);
    const fresh=(await rows())[0];
    expect((await request('/editor_records/rows','PATCH',{key:{id:row.key.id},version:fresh.version,values:{note:'bad'}})).status).toBe(422);
    expect((await request('/editor_records/rows','PATCH',{key:fresh.key,version:fresh.version,values:{password:'bad'}})).status).toBe(422);
    expect((await request('/app_setup/rows','PATCH',{key:{singleton:'true'},version:'1',values:{completed:false}})).status).toBe(403);
    expect((await request('/users/rows','POST',{values:{}})).status).toBe(403);
    const users=(await (await request('/users/rows')).json()).rows;
    expect(JSON.stringify(users)).not.toContain('hash-must-stay-secret');
    const admin=users.find((r:{key:{id:string}})=>r.key.id===adminId);
    expect((await request('/users/rows','PATCH',{key:admin.key,version:admin.version,values:{role:'user'}})).status).toBe(422);
    expect((await request('/users/rows','PATCH',{key:admin.key,version:admin.version,values:{username:'renamed-admin'}})).status).toBe(200);
    expect((await request('/users/rows','DELETE',{key:admin.key,version:admin.version})).status).toBe(403);
    const sessions=await (await request('/sessions/rows')).json(); expect(sessions.rows.every((r:{values:{id:null}})=>r.values.id===null)).toBe(true);
  });
  test('bounds values, returns safe constraint errors, and deletes only the selected revision',async()=>{
    const response=await request('/editor_records/rows','POST',{values:{tenant:'999',id:'invalid',name:'private-value'}});
    expect(response.status).toBe(422);expect(JSON.stringify(await response.json())).not.toContain('private-value');
    await sql`INSERT INTO editor_records (tenant,id,name,note) VALUES (1,'large','large',${'x'.repeat(10000)})`;
    const data=await rows();const large=data.find((r:{key:{id:string}})=>r.key.id==='large');
    expect(large.values.note.length).toBe(4096);expect(large.truncated).toContain('note');
    const target=data.find((r:{key:{id:string}})=>r.key.id!== 'large');
    expect((await request('/editor_records/rows','DELETE',{key:target.key,version:'0'})).status).toBe(409);
    expect((await request('/editor_records/rows','DELETE',{key:target.key,version:target.version})).status).toBe(200);
    expect((await rows()).length).toBe(1);
    const page=await (await request('/editor_records/rows?limit=1')).json();expect(page.limit).toBe(1);
  });
  test('cancels slow PostgreSQL queries and returns a safe retryable error',async()=>{
    const started=Date.now();const response=await request('/editor_slow/rows');
    expect(response.status).toBe(409);expect((await response.json()).code).toBe('DATABASE_BUSY');
    expect(Date.now()-started).toBeLessThan(5000);expect((await request('')).status).toBe(200);
  });
  test('enforces shared rate limits before expensive database operations',async()=>{
    await sql`UPDATE rate_limits SET request_count = 100000 WHERE scope = 'database.read.ip'`;
    const response=await request(''); expect(response.status).toBe(429);expect(response.headers.get('Retry-After')).not.toBeNull();
  });
});
afterAll(async()=>{ if(!enabled)return; server?.stop(true);await sql.close(); });
