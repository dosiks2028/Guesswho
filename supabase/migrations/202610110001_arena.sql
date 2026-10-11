create schema if not exists game_private;
revoke all on schema game_private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 2 and 24),
  coins integer not null default 0 check (coins >= 0),
  wins integer not null default 0,
  games integer not null default 0,
  frame text not null default 'default',
  owned text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  category text not null check (category in ('attack-on-titan','naruto','harry-potter','avengers')),
  host_id uuid not null references public.profiles(id),
  guest_id uuid references public.profiles(id),
  host_name text not null,
  guest_name text,
  status text not null default 'waiting' check (status in ('waiting','selecting','playing','finished')),
  turn_id uuid,
  winner_id uuid,
  host_ready boolean not null default false,
  guest_ready boolean not null default false,
  is_public boolean not null default true,
  moves integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check (guest_id is distinct from host_id)
);
create table game_private.characters (id text primary key, category text not null);
create table game_private.secrets (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  character_id text not null references game_private.characters(id),
  primary key (room_id, user_id)
);
create table public.game_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  username text not null,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);
create index messages_room_time on public.game_messages(room_id, created_at);
create index rooms_lobby on public.rooms(status, created_at desc) where is_public;
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.game_messages enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id = auth.uid());
create policy room_read on public.rooms for select to authenticated using (host_id = auth.uid() or guest_id = auth.uid());
create policy message_read on public.game_messages for select to authenticated using (exists (select 1 from public.rooms r where r.id = room_id and auth.uid() in (r.host_id, r.guest_id)));
revoke all on public.profiles, public.rooms, public.game_messages from anon, authenticated;
grant select on public.profiles, public.rooms, public.game_messages to authenticated;

create function public.ensure_profile(p_username text default 'Detective') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  insert into public.profiles(id, username) values (auth.uid(), left(coalesce(nullif(trim(p_username), ''), 'Detective'), 24)) on conflict (id) do nothing;
  select * into p from public.profiles where id = auth.uid();
  return to_jsonb(p);
end;
$$;
create function public.update_profile(p_username text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  if char_length(trim(p_username)) not between 2 and 24 then raise exception 'INVALID_NAME'; end if;
  update public.profiles set username = trim(p_username) where id = auth.uid() returning * into p;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  return to_jsonb(p);
end;
$$;
create function public.list_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) - 'code') from (select * from public.rooms where is_public and status = 'waiting' and created_at > now() - interval '2 hours' order by created_at desc limit 50) r), '[]'::jsonb);
end;
$$;
create function public.create_room(p_category text, p_public boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n text;
begin
  select username into n from public.profiles where id = auth.uid() for update;
  if n is null then raise exception 'UNAUTHORIZED'; end if;
  if (select count(*) from public.rooms where host_id = auth.uid() and status != 'finished' and created_at > now() - interval '2 hours') >= 3 then raise exception 'ROOM_LIMIT'; end if;
  insert into public.rooms(category, host_id, host_name, is_public) values (p_category, auth.uid(), n, p_public) returning * into r;
  return to_jsonb(r);
end;
$$;
create function public.join_room(p_code text default null, p_room uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; n text;
begin
  select username into n from public.profiles where id = auth.uid();
  if n is null then raise exception 'UNAUTHORIZED'; end if;
  select * into r from public.rooms where (code = upper(trim(p_code)) or (id = p_room and is_public)) and created_at > now() - interval '2 hours' for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if auth.uid() in (r.host_id, r.guest_id) then return to_jsonb(r); end if;
  if r.status != 'waiting' or r.guest_id is not null then raise exception 'ROOM_FULL'; end if;
  update public.rooms set guest_id = auth.uid(), guest_name = n, status = 'selecting' where id = r.id returning * into r;
  return to_jsonb(r);
end;
$$;
create function public.get_game(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; s text; m jsonb;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id);
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select character_id into s from game_private.secrets where room_id = p_room and user_id = auth.uid();
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at), '[]'::jsonb) into m from (select id, sender_id, username, body, created_at from public.game_messages where room_id = p_room order by created_at desc limit 100) recent;
  return jsonb_build_object('room', to_jsonb(r), 'secret', s, 'messages', m);
end;
$$;
create function public.select_secret(p_room uuid, p_character text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id) for update;
  if r.id is null or r.status not in ('waiting', 'selecting') then raise exception 'INVALID_STATE'; end if;
  if not exists (select 1 from game_private.characters where id = p_character and category = r.category) then raise exception 'INVALID_CHARACTER'; end if;
  insert into game_private.secrets values (p_room, auth.uid(), p_character) on conflict (room_id, user_id) do update set character_id = excluded.character_id;
  update public.rooms set host_ready = host_ready or host_id = auth.uid(), guest_ready = guest_ready or coalesce(guest_id = auth.uid(), false) where id = p_room returning * into r;
  if r.host_ready and r.guest_ready then update public.rooms set status = 'playing', turn_id = host_id, started_at = now() where id = p_room; end if;
end;
$$;
create function public.send_message(p_room uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare n text; v text := trim(p_body);
begin
  select username into n from public.profiles where id = auth.uid() for update;
  if n is null or not exists (select 1 from public.rooms where id = p_room and auth.uid() in (host_id, guest_id)) then raise exception 'UNAUTHORIZED'; end if;
  if char_length(v) not between 1 and 300 then raise exception 'INVALID_MESSAGE'; end if;
  if exists (select 1 from public.game_messages where sender_id = auth.uid() and created_at > now() - interval '700 milliseconds') then raise exception 'RATE_LIMIT'; end if;
  if (v = '🔥' and not exists (select 1 from public.profiles where id = auth.uid() and 'emoji-fire' = any(owned))) or (v = '🧠' and not exists (select 1 from public.profiles where id = auth.uid() and 'emoji-brain' = any(owned))) or (v = '👑' and not exists (select 1 from public.profiles where id = auth.uid() and 'emoji-crown' = any(owned))) then raise exception 'NOT_OWNED'; end if;
  insert into public.game_messages(room_id, sender_id, username, body) values (p_room, auth.uid(), n, v);
end;
$$;
create function public.pass_turn(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id) for update;
  if r.id is null or r.status != 'playing' or r.turn_id != auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  update public.rooms set turn_id = case when host_id = auth.uid() then guest_id else host_id end, moves = moves + 1 where id = p_room;
end;
$$;
create function public.guess_character(p_room uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; opponent uuid; target text; winner uuid; reward integer := 0;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id) for update;
  if r.id is null or r.status != 'playing' or r.turn_id != auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  if not exists (select 1 from game_private.characters where id = p_character and category = r.category) then raise exception 'INVALID_CHARACTER'; end if;
  opponent := case when r.host_id = auth.uid() then r.guest_id else r.host_id end;
  select character_id into target from game_private.secrets where room_id = p_room and user_id = opponent;
  winner := case when target = p_character then auth.uid() else opponent end;
  if r.moves >= 2 and r.started_at < now() - interval '30 seconds' and (select count(*) from public.rooms where winner_id = winner and finished_at > now() - interval '24 hours') < 20 then reward := 50; end if;
  update public.rooms set status = 'finished', winner_id = winner, finished_at = now() where id = p_room;
  update public.profiles set games = games + 1, wins = wins + case when id = winner then 1 else 0 end, coins = coins + case when id = winner then reward else 0 end where id in (r.host_id, r.guest_id);
  return jsonb_build_object('correct', target = p_character, 'winner_id', winner, 'reward', reward);
end;
$$;
create function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status = 'finished' then return; end if;
  if r.status = 'playing' then
    update public.profiles set games = games + 1, wins = wins + case when id != auth.uid() then 1 else 0 end where id in (r.host_id, r.guest_id);
  end if;
  update public.rooms set status = 'finished', winner_id = case when r.status = 'playing' then case when host_id = auth.uid() then guest_id else host_id end else null end, finished_at = now() where id = p_room;
end;
$$;
create function public.buy_item(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; price integer;
begin
  price := case p_item when 'frame-lime' then 150 when 'frame-violet' then 250 when 'frame-gold' then 500 when 'emoji-fire' then 100 when 'emoji-brain' then 100 when 'emoji-crown' then 200 else null end;
  if price is null then raise exception 'INVALID_ITEM'; end if;
  select * into p from public.profiles where id = auth.uid() for update;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_item = any(p.owned) then return to_jsonb(p); end if;
  if p.coins < price then raise exception 'INSUFFICIENT_COINS'; end if;
  update public.profiles set coins = coins - price, owned = array_append(owned, p_item) where id = auth.uid() returning * into p;
  return to_jsonb(p);
end;
$$;
create function public.equip_frame(p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid() for update;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  if p_item != 'default' and (p_item not in ('frame-lime','frame-violet','frame-gold') or not (p_item = any(p.owned))) then raise exception 'NOT_OWNED'; end if;
  update public.profiles set frame = p_item where id = auth.uid() returning * into p;
  return to_jsonb(p);
end;
$$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.ensure_profile(text), public.update_profile(text), public.list_rooms(), public.create_room(text, boolean), public.join_room(text, uuid), public.get_game(uuid), public.select_secret(uuid, text), public.send_message(uuid, text), public.pass_turn(uuid), public.guess_character(uuid, text), public.leave_room(uuid), public.buy_item(text), public.equip_frame(text) to authenticated;

create policy voice_read on realtime.messages for select to authenticated using (
  exists (select 1 from public.rooms where 'voice:' || id::text = realtime.topic() and auth.uid() in (host_id, guest_id) and status != 'finished')
);
create policy voice_write on realtime.messages for insert to authenticated with check (
  exists (select 1 from public.rooms where 'voice:' || id::text = realtime.topic() and auth.uid() in (host_id, guest_id) and status != 'finished')
);
alter publication supabase_realtime add table public.rooms, public.game_messages;
