create table public.decks(id text primary key,owner_id uuid references public.profiles(id),data jsonb not null,published boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.deck_votes(deck_id text references public.decks(id) on delete cascade,user_id uuid references public.profiles(id),vote integer not null check(vote in(-1,1)),primary key(deck_id,user_id));
alter table public.decks enable row level security;
alter table public.deck_votes enable row level security;
revoke all on public.decks,public.deck_votes from public,anon,authenticated;
alter table public.rooms drop constraint rooms_category_check;
alter table public.rooms add column deck jsonb;
alter table game_private.secrets drop constraint secrets_character_id_fkey;

create function public.save_deck(p_id text,p_data jsonb,p_published boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare d public.decks; c jsonb; image bytea; identity text:=coalesce(p_id,gen_random_uuid()::text);
begin
  perform id from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'UNAUTHORIZED'; end if;
  if p_id is not null then
    select * into d from public.decks where id=p_id for update;
    if d.owner_id is distinct from auth.uid() then raise exception 'NOT_OWNED'; end if;
  elsif (select count(*) from public.decks where owner_id=auth.uid())>=20 then raise exception 'DECK_LIMIT'; end if;
  if p_data is null or jsonb_typeof(p_data)!='object' or length(p_data::text)>6000000 or coalesce(length(trim(p_data->>'title')),0) not between 2 and 60 or coalesce(length(trim(p_data->>'titleEn')),0) not between 2 and 60 or coalesce(length(p_data->>'subtitle'),0)>200 or coalesce(length(p_data->>'subtitleEn'),0)>200 or coalesce(p_data->>'color','') !~ '^#[0-9a-fA-F]{6}$' or jsonb_typeof(p_data->'characters') is distinct from 'array' then raise exception 'INVALID_DECK'; end if;
  if jsonb_array_length(p_data->'characters') not between 6 and 64 then raise exception 'INVALID_DECK_SIZE'; end if;
  if (select count(distinct entry->>'id') from jsonb_array_elements(p_data->'characters') entry)!=jsonb_array_length(p_data->'characters') then raise exception 'INVALID_CHARACTER'; end if;
  for c in select * from jsonb_array_elements(p_data->'characters') loop
    if coalesce(c->>'id','') !~ '^[a-zA-Z0-9_-]{1,80}$' or coalesce(length(trim(c->>'name')),0) not between 1 and 60 or coalesce(length(trim(c->>'nameEn')),0) not between 1 and 60 or jsonb_typeof(c->'traits') is distinct from 'array' then raise exception 'INVALID_CHARACTER'; end if;
    if jsonb_array_length(c->'traits')>10 or exists(select 1 from jsonb_array_elements_text(c->'traits') t where t not in('male','female','dark','light','glasses')) then raise exception 'INVALID_TRAITS'; end if;
    if coalesce(c->>'img','') ~ '^/images/[a-z0-9-]+/[a-z0-9-]+[.]webp$' then
      if not exists(select 1 from public.decks official_deck,jsonb_array_elements(official_deck.data->'characters') official where official_deck.owner_id is null and official->>'img'=c->>'img') then raise exception 'INVALID_IMAGE'; end if;
    else
      if coalesce(length(c->>'img'),0)>90000 or coalesce(c->>'img','') !~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$' then raise exception 'INVALID_IMAGE'; end if;
      image:=decode(substr(c->>'img',24),'base64');
      if octet_length(image)<20 or substring(image from 1 for 4)!=decode('52494646','hex') or substring(image from 9 for 4)!=decode('57454250','hex') then raise exception 'INVALID_IMAGE'; end if;
    end if;
  end loop;
  p_data:=jsonb_build_object('id',identity,'title',trim(p_data->>'title'),'titleEn',trim(p_data->>'titleEn'),'subtitle',coalesce(p_data->>'subtitle',''),'subtitleEn',coalesce(p_data->>'subtitleEn',''),'color',p_data->>'color','characters',p_data->'characters');
  insert into public.decks(id,owner_id,data,published) values(identity,auth.uid(),p_data,p_published) on conflict(id) do update set data=excluded.data,published=excluded.published,updated_at=now();
  return identity;
end $$;
create function public.list_decks(p_search text default '',p_page integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d)) from (select d.id,d.owner_id,p.username as author,d.published,d.data->>'title' as title,d.data->>'titleEn' as "titleEn",d.data->>'subtitle' as subtitle,d.data->>'subtitleEn' as "subtitleEn",d.data->>'color' as color,d.data->'characters'->0->>'img' as cover,jsonb_array_length(d.data->'characters') as size,(select count(*) from public.deck_votes where deck_id=d.id and vote=1) as likes,(select count(*) from public.deck_votes where deck_id=d.id and vote=-1) as dislikes,coalesce((select vote from public.deck_votes where deck_id=d.id and user_id=auth.uid()),0) as my_vote from public.decks d left join public.profiles p on p.id=d.owner_id where (d.published or d.owner_id=auth.uid()) and (d.data->>'title' ilike '%'||left(p_search,60)||'%' or d.data->>'titleEn' ilike '%'||left(p_search,60)||'%') order by (d.owner_id is null) desc,d.created_at desc,d.id limit 20 offset least(greatest(p_page,0),10000)*20) d),'[]');
end $$;
create function public.get_deck(p_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.decks;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into d from public.decks where id=p_id and (published or owner_id=auth.uid());
  if d.id is null then raise exception 'DECK_NOT_FOUND'; end if;
  return jsonb_build_object('id',d.id,'owner_id',d.owner_id,'published',d.published,'data',d.data);
end $$;
create function public.vote_deck(p_id text,p_vote integer) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_vote is null or p_vote not in(-1,0,1) then raise exception 'INVALID_VOTE'; end if;
  if not exists(select 1 from public.decks where id=p_id and published and owner_id!=auth.uid()) then raise exception 'INVALID_DECK'; end if;
  if p_vote=0 then delete from public.deck_votes where deck_id=p_id and user_id=auth.uid();
  else insert into public.deck_votes values(p_id,auth.uid(),p_vote) on conflict(deck_id,user_id) do update set vote=excluded.vote; end if;
end $$;
create or replace function public.create_room(p_category text,p_public boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; n text; pack jsonb;
begin
  select username into n from public.profiles where id=auth.uid() for update;
  if n is null then raise exception 'UNAUTHORIZED'; end if;
  select data into pack from public.decks where id=p_category and (published or owner_id=auth.uid());
  if pack is null then raise exception 'DECK_NOT_FOUND'; end if;
  if (select count(*) from public.rooms where host_id=auth.uid() and status!='finished' and created_at>now()-interval '2 hours')>=3 then raise exception 'ROOM_LIMIT'; end if;
  insert into public.rooms(category,host_id,host_name,is_public,deck) values(p_category,auth.uid(),n,p_public,pack) returning * into r;
  return to_jsonb(r)-'deck';
end $$;
create function public.get_room_deck(p_room uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id);
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  return coalesce(r.deck,(select data from public.decks where id=r.category));
end $$;
create function game_private.room_has_character(r public.rooms,p_character text) returns boolean
language sql stable set search_path='' as $$
  select case when r.deck is null then exists(select 1 from game_private.characters where id=p_character and category=r.category) else exists(select 1 from jsonb_array_elements(r.deck->'characters') c where c->>'id'=p_character) end;
$$;
revoke all on function game_private.room_has_character(public.rooms,text) from public,anon,authenticated;
create or replace function public.select_secret(p_room uuid,p_character text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id) for update;
  if r.id is null or r.status not in('waiting','selecting') then raise exception 'INVALID_STATE'; end if;
  if not game_private.room_has_character(r,p_character) then raise exception 'INVALID_CHARACTER'; end if;
  insert into game_private.secrets values(p_room,auth.uid(),p_character) on conflict(room_id,user_id) do update set character_id=excluded.character_id;
  update public.rooms set host_ready=host_ready or host_id=auth.uid(),guest_ready=guest_ready or coalesce(guest_id=auth.uid(),false) where id=p_room returning * into r;
  if r.host_ready and r.guest_ready then update public.rooms set status='playing',turn_id=host_id,started_at=now() where id=p_room; end if;
end $$;
create or replace function public.guess_character(p_room uuid,p_character text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; opponent uuid; target text; correct boolean; result jsonb;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id) for update;
  if r.id is null or r.status!='playing' or r.turn_id!=auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  if not game_private.room_has_character(r,p_character) then raise exception 'INVALID_CHARACTER'; end if;
  opponent:=case when r.host_id=auth.uid() then r.guest_id else r.host_id end;
  select character_id into target from game_private.secrets where room_id=p_room and user_id=opponent;
  correct:=target=p_character;
  if r.pending_winner is not null then
    result:=game_private.complete_match(p_room,case when correct then null else r.pending_winner end,false);
    return result||jsonb_build_object('correct',correct);
  end if;
  update public.rooms set turn_id=opponent,moves=moves+1,pending_winner=case when correct then auth.uid() else null end where id=p_room;
  return jsonb_build_object('correct',correct,'last_chance',correct,'winner_id',null,'reward',0);
end $$;
revoke all on function public.save_deck(text,jsonb,boolean),public.list_decks(text,integer),public.get_deck(text),public.vote_deck(text,integer),public.get_room_deck(uuid) from public,anon;
grant execute on function public.save_deck(text,jsonb,boolean),public.list_decks(text,integer),public.get_deck(text),public.vote_deck(text,integer),public.get_room_deck(uuid) to authenticated;
