create table game_private.room_presence(room_id uuid references public.rooms(id) on delete cascade,user_id uuid references public.profiles(id),connection_id text not null,online boolean not null default true,last_seen timestamptz not null default now(),primary key(room_id,user_id,connection_id));
create index presence_room_seen on game_private.room_presence(room_id,last_seen);
create function game_private.expire_rooms() returns integer
language plpgsql security definer set search_path='' as $$
declare r public.rooms; h_alive boolean; g_alive boolean; h_seen timestamptz; g_seen timestamptz; expired integer:=0;
begin
  for r in select * from public.rooms where status!='finished' and exists(select 1 from game_private.room_presence where room_id=rooms.id) order by created_at limit 200 for update skip locked loop
    select coalesce(bool_or(online and last_seen>now()-interval '45 seconds'),false),max(last_seen) into h_alive,h_seen from game_private.room_presence where room_id=r.id and user_id=r.host_id;
    select coalesce(bool_or(online and last_seen>now()-interval '45 seconds'),false),max(last_seen) into g_alive,g_seen from game_private.room_presence where room_id=r.id and user_id=r.guest_id;
    if r.guest_id is not null and h_seen is not null and g_seen is not null and not h_alive and not g_alive then
      update public.rooms set status='finished',outcome='cancelled',pending_winner=null,turn_id=null,finished_at=now() where id=r.id;
      expired:=expired+1;
    elsif (not h_alive and h_seen<now()-interval '60 seconds') or (r.guest_id is not null and not g_alive and g_seen<now()-interval '60 seconds') then
      if r.status='playing' and (h_alive or g_alive) then
        perform game_private.complete_match(r.id,case when h_alive then r.host_id else r.guest_id end,true);
      else
        update public.rooms set status='finished',outcome='cancelled',turn_id=null,finished_at=now() where id=r.id;
      end if;
      expired:=expired+1;
    end if;
  end loop;
  return expired;
end $$;
create function public.room_presence(p_room uuid,p_connection text,p_online boolean default true) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.rooms where id=p_room and auth.uid() in(host_id,guest_id)) then raise exception 'ROOM_NOT_FOUND'; end if;
  if p_connection is null or p_connection !~ '^[a-zA-Z0-9-]{1,64}$' or p_online is null then raise exception 'INVALID_CONNECTION'; end if;
  if p_online then
    delete from game_private.room_presence where room_id=p_room and user_id=auth.uid() and connection_id='pending';
    delete from game_private.room_presence where room_id=p_room and user_id=auth.uid() and last_seen<now()-interval '2 minutes';
    if (select count(*) from game_private.room_presence where room_id=p_room and user_id=auth.uid())>=10 and not exists(select 1 from game_private.room_presence where room_id=p_room and user_id=auth.uid() and connection_id=p_connection) then raise exception 'ROOM_LIMIT'; end if;
    insert into game_private.room_presence values(p_room,auth.uid(),p_connection,true,now()) on conflict(room_id,user_id,connection_id) do update set online=true,last_seen=now();
  else
    update game_private.room_presence set online=false,last_seen=now() where room_id=p_room and user_id=auth.uid() and connection_id=p_connection;
    perform game_private.expire_rooms();
  end if;
end $$;
create function game_private.seed_presence() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then insert into game_private.room_presence values(new.id,new.host_id,'pending',true,now()) on conflict do nothing; end if;
  if new.guest_id is not null and (tg_op='INSERT' or old.guest_id is null) then insert into game_private.room_presence values(new.id,new.guest_id,'pending',true,now()) on conflict do nothing; end if;
  return new;
end $$;
create trigger seed_room_presence after insert or update of guest_id on public.rooms for each row execute function game_private.seed_presence();
revoke all on function game_private.expire_rooms(),game_private.seed_presence() from public,anon,authenticated;
revoke all on function public.room_presence(uuid,text,boolean) from public,anon;
grant execute on function public.room_presence(uuid,text,boolean) to authenticated;
