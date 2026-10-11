create function public.can_voice(p_room uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rooms r join game_private.friendships f on f.status='accepted' and ((f.requester=r.host_id and f.recipient=r.guest_id) or (f.requester=r.guest_id and f.recipient=r.host_id)) where r.id=p_room and auth.uid() in(r.host_id,r.guest_id));
$$;
revoke all on function public.can_voice(uuid) from public,anon;
grant execute on function public.can_voice(uuid) to authenticated;
alter policy voice_read on realtime.messages to authenticated using (
  exists(select 1 from public.rooms r where 'voice:'||r.id::text=realtime.topic() and public.can_voice(r.id))
);
alter policy voice_write on realtime.messages to authenticated with check (
  exists(select 1 from public.rooms r where 'voice:'||r.id::text=realtime.topic() and public.can_voice(r.id))
);

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
  return jsonb_build_object('room',(to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn')),'voice_allowed',public.can_voice(p_room),'secret',s,'messages',m,'players',players,'own_closed',(select to_jsonb(closed) from game_private.boards where room_id=p_room and user_id=auth.uid()),'own_board_version',coalesce((select version from game_private.boards where room_id=p_room and user_id=auth.uid()),0),'opponent_closed',coalesce((select to_jsonb(closed) from game_private.boards where room_id=p_room and user_id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end),'[]'::jsonb));
end;
$$;
