alter table public.profiles add column avatar text;
create function public.update_avatar(p_avatar text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; image bytea;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_avatar is not null then
    if length(p_avatar)>100000 or p_avatar !~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$' then raise exception 'INVALID_AVATAR'; end if;
    image:=decode(substr(p_avatar,24),'base64');
    if octet_length(image)<20 or substring(image from 1 for 4)!=decode('52494646','hex') or substring(image from 9 for 4)!=decode('57454250','hex') then raise exception 'INVALID_AVATAR'; end if;
  end if;
  update public.profiles set avatar=p_avatar where id=auth.uid() returning * into p;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  return to_jsonb(p);
end;
$$;
revoke all on function public.update_avatar(text) from public,anon;
grant execute on function public.update_avatar(text) to authenticated;

create or replace function public.get_game(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; s text; m jsonb; players jsonb;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in (host_id,guest_id);
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select character_id into s from game_private.secrets where room_id=p_room and user_id=auth.uid();
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at),'[]'::jsonb) into m from (select id,sender_id,username,body,created_at from public.game_messages where room_id=p_room order by created_at desc limit 100) recent;
  select jsonb_object_agg(id::text,jsonb_build_object('avatar',avatar,'title',title,'rating',rating,'frame',frame)) into players from public.profiles where id in (r.host_id,r.guest_id);
  return jsonb_build_object('room',to_jsonb(r),'secret',s,'messages',m,'players',players);
end;
$$;
create or replace function public.list_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)-'code') from (select r.*,p.avatar as host_avatar,p.title as host_title,p.rating as host_rating,p.frame as host_frame from public.rooms r join public.profiles p on p.id=r.host_id where r.is_public and r.status='waiting' and r.created_at>now()-interval '2 hours' order by r.created_at desc limit 50) r),'[]'::jsonb);
end;
$$;
create or replace function public.leaderboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from (select id,username,rating,rated_games,wins,title,frame,avatar from public.profiles where rated_games>0 order by rating desc,wins desc,id limit 50) p),'[]'::jsonb);
end;
$$;
