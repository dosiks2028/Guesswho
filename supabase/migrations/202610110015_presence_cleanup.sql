insert into game_private.room_presence(room_id,user_id,connection_id) select id,host_id,'pending' from public.rooms where status!='finished' on conflict do nothing;
insert into game_private.room_presence(room_id,user_id,connection_id) select id,guest_id,'pending' from public.rooms where status!='finished' and guest_id is not null on conflict do nothing;
create or replace function public.get_game(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; s text; m jsonb; players jsonb;
begin
  perform game_private.expire_rooms();
  select * into r from public.rooms where id=p_room and auth.uid() in (host_id,guest_id);
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  select character_id into s from game_private.secrets where room_id=p_room and user_id=auth.uid();
  select coalesce(jsonb_agg(to_jsonb(recent) order by recent.created_at),'[]'::jsonb) into m from (select id,sender_id,username,body,created_at from public.game_messages where room_id=p_room order by created_at desc limit 100) recent;
  select jsonb_object_agg(id::text,jsonb_build_object('avatar',avatar,'title',title,'rating',rating,'frame',frame,'staff_badge',staff_badge)) into players from public.profiles where id in (r.host_id,r.guest_id);
  return jsonb_build_object('room',(to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn')),'secret',s,'messages',m,'players',players);
end;
$$;
create or replace function public.list_my_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform game_private.expire_rooms();
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg((to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn'))) from (select * from public.rooms where auth.uid() in (host_id, guest_id) and status != 'finished' order by created_at desc limit 10) r), '[]'::jsonb);
end;
$$;
create or replace function public.list_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform game_private.expire_rooms();
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg((to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn'))-'code') from (select r.*,p.avatar as host_avatar,p.title as host_title,p.rating as host_rating,p.frame as host_frame,p.staff_badge as host_staff_badge from public.rooms r join public.profiles p on p.id=r.host_id where r.is_public and r.status='waiting' and r.created_at>now()-interval '2 hours' order by r.created_at desc limit 50) r),'[]'::jsonb);
end;
$$;
