import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

export async function createDatabase(directory) {
  if (directory !== 'memory://') await mkdir(directory, { recursive: true });
  const db = new PGlite(directory);
  await db.waitReady;
  await db.exec('create schema if not exists game_private; create table if not exists game_private.local_migrations(name text primary key, applied_at timestamptz default now());');
  const { rows } = await db.query('select name from game_private.local_migrations');
  if (!rows.length) {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create schema realtime; create table realtime.messages(id uuid); create function realtime.topic() returns text language sql stable as $$ select ''::text $$;`);
  }
  const folder = resolve('supabase/migrations');
  for (const name of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
    if (rows.some(row => row.name === name)) continue;
    const sql = (await readFile(resolve(folder,name),'utf8')).replace('alter publication supabase_realtime add table public.rooms, public.game_messages;', '');
    await db.transaction(async tx => { await tx.exec(sql); await tx.query('insert into game_private.local_migrations(name) values ($1)',[name]); });
  }
  await db.exec('create table if not exists game_private.sessions(hash text primary key, user_id uuid not null references auth.users(id), expires_at timestamptz not null default now() + interval \'90 days\'); create index if not exists sessions_user on game_private.sessions(user_id);');
  await db.exec('create table if not exists game_private.recovery_codes(user_id uuid primary key references auth.users(id), hash text unique not null);');
  const methods = {
    streak_status: [], start_practice_streak: [['p_category','text']], finish_practice_streak: [['p_ticket','uuid'],['p_outcome','text']], request_match_friend: [['p_room','uuid']], can_voice: [['p_room','uuid']], set_board: [['p_room','uuid'],['p_closed','jsonb']], list_my_rooms: [], room_presence: [['p_room','uuid'],['p_connection','text'],['p_online','boolean',true]],
    match_history: [['p_opponent','uuid',null]],
    list_decks: [['p_search','text',''],['p_page','integer',0]], get_deck: [['p_id','text']], save_deck: [['p_id','text',null],['p_data','jsonb'],['p_published','boolean',false]], vote_deck: [['p_id','text'],['p_vote','integer']], get_room_deck: [['p_room','uuid']],
    leaderboard: [], equip_title: [['p_title','text']],
    update_avatar: [['p_avatar','text',null]],
    get_friends: [], request_friend: [['p_code','text']], respond_friend: [['p_user','uuid'],['p_accept','boolean']], remove_friend: [['p_user','uuid']], invite_friend: [['p_user','uuid'],['p_category','text'],['p_ranked','boolean',false]], accept_invite: [['p_invite','uuid']],
    ensure_profile: [['p_username','text','Detective']], update_profile: [['p_username','text']], list_rooms: [], create_room: [['p_category','text'],['p_public','boolean',true],['p_ranked','boolean',true]], join_room: [['p_code','text',null],['p_room','uuid',null]], get_game: [['p_room','uuid']], select_secret: [['p_room','uuid'],['p_character','text']], send_message: [['p_room','uuid'],['p_body','text']], pass_turn: [['p_room','uuid']], guess_character: [['p_room','uuid'],['p_character','text']], leave_room: [['p_room','uuid']], buy_item: [['p_item','text']], equip_frame: [['p_item','text']],
  };
  const hash = token => createHash('sha256').update(token).digest('hex');
  async function authenticate(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const result = await db.query('select user_id from game_private.sessions where hash=$1 and expires_at > now()', [hash(token)]);
    return result.rows[0]?.user_id || null;
  }
  async function call(id, fn, args = {}) {
    if (!Object.hasOwn(methods,fn)) throw new Error('UNKNOWN_METHOD');
    if (!id) throw new Error('UNAUTHORIZED');
    const spec = methods[fn];
    const values = spec.map(([key,,fallback]) => {
      const value = args[key] === undefined ? fallback : args[key];
      if (value === undefined) throw new Error('INVALID_ARGUMENT');
      return spec.find(entry => entry[0] === key)?.[1] === 'jsonb' ? JSON.stringify(value) : value;
    });
    return db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
      await tx.exec('set local role authenticated');
      const result = await tx.query(`select public.${fn}(${spec.map(([,type],i) => `$${i + 1}::${type}`).join(',')}) as value`, values);
      return result.rows[0]?.value;
    });
  }
  async function session(token, username) {
    let id = await authenticate(token);
    if (!id) {
      id = randomUUID(); token = randomBytes(32).toString('hex');
      await db.transaction(async tx => { await tx.query('insert into auth.users values ($1)',[id]); await tx.query('insert into game_private.sessions(hash,user_id) values ($1,$2)',[hash(token),id]); });
    }
    const cleanName = typeof username === 'string' && username.trim().length >= 2 ? username.trim().slice(0,24) : 'Detective';
    return { token, profile: await call(id,'ensure_profile',{p_username:cleanName}) };
  }
  async function createRecovery(id) {
    if (!id) throw new Error('UNAUTHORIZED');
    const code = randomBytes(16).toString('hex').toUpperCase();
    await db.query('insert into game_private.recovery_codes(user_id,hash) values ($1,$2) on conflict (user_id) do update set hash=excluded.hash',[id,hash(code)]);
    return code.match(/.{1,8}/g).join('-');
  }
  async function recover(code) {
    const clean = typeof code === 'string' ? code.replace(/-/g,'').trim().toUpperCase() : '';
    if (!/^[A-F0-9]{32}$/.test(clean)) throw new Error('INVALID_RECOVERY_CODE');
    const result = await db.query('select user_id from game_private.recovery_codes where hash=$1',[hash(clean)]);
    const id = result.rows[0]?.user_id;
    if (!id) throw new Error('INVALID_RECOVERY_CODE');
    const token = randomBytes(32).toString('hex');
    await db.query('insert into game_private.sessions(hash,user_id) values ($1,$2)',[hash(token),id]);
    return {token,profile:await call(id,'ensure_profile')};
  }
  return { db, authenticate, call, session, createRecovery, recover, close: () => db.close() };
}
