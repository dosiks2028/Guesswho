alter table public.profiles add column friend_code text unique not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
create table game_private.friendships(requester uuid not null references public.profiles(id),recipient uuid not null references public.profiles(id),status text not null default 'pending' check(status in ('pending','accepted')),created_at timestamptz not null default now(),primary key(requester,recipient),check(requester!=recipient));
create unique index friendship_pair on game_private.friendships(least(requester,recipient),greatest(requester,recipient));
create table game_private.invites(id uuid primary key default gen_random_uuid(),sender uuid not null references public.profiles(id),recipient uuid not null references public.profiles(id),room_id uuid not null references public.rooms(id),created_at timestamptz not null default now(),unique(recipient,room_id));
revoke all on game_private.friendships,game_private.invites from public,anon,authenticated;

create function public.request_friend(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare recipient_id uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select id into recipient_id from public.profiles where friend_code=upper(trim(p_code));
  if recipient_id is null or recipient_id=auth.uid() then raise exception 'INVALID_FRIEND'; end if;
  if (select count(*) from game_private.friendships where requester=auth.uid() and created_at>now()-interval '24 hours')>=30 then raise exception 'RATE_LIMIT'; end if;
  insert into game_private.friendships(requester,recipient) values(auth.uid(),recipient_id) on conflict do nothing;
end;
$$;
create function public.respond_friend(p_user uuid,p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_accept then
    update game_private.friendships set status='accepted' where requester=p_user and recipient=auth.uid() and status='pending';
    if not found then raise exception 'INVALID_FRIEND'; end if;
  else
    delete from game_private.friendships where requester=p_user and recipient=auth.uid() and status='pending';
  end if;
end;
$$;
create function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from game_private.friendships where (requester=auth.uid() and recipient=p_user) or (recipient=auth.uid() and requester=p_user);
  delete from game_private.invites where (sender=auth.uid() and recipient=p_user) or (recipient=auth.uid() and sender=p_user);
end;
$$;
create function public.get_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare friends jsonb; incoming jsonb; outgoing jsonb; invites jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'rating',p.rating,'friend_code',p.friend_code) order by p.username),'[]'::jsonb) into friends from game_private.friendships f join public.profiles p on p.id=case when f.requester=auth.uid() then f.recipient else f.requester end where auth.uid() in(f.requester,f.recipient) and f.status='accepted';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'rating',p.rating)),'[]'::jsonb) into incoming from game_private.friendships f join public.profiles p on p.id=f.requester where f.recipient=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'rating',p.rating)),'[]'::jsonb) into outgoing from game_private.friendships f join public.profiles p on p.id=f.recipient where f.requester=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'username',p.username,'category',r.category,'room_id',r.id)),'[]'::jsonb) into invites from game_private.invites i join public.profiles p on p.id=i.sender join public.rooms r on r.id=i.room_id where i.recipient=auth.uid() and i.created_at>now()-interval '15 minutes' and r.status='waiting';
  return jsonb_build_object('friends',friends,'incoming',incoming,'outgoing',outgoing,'invites',invites);
end;
$$;
create function public.invite_friend(p_user uuid,p_category text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare room jsonb;
begin
  if not exists(select 1 from game_private.friendships where status='accepted' and ((requester=auth.uid() and recipient=p_user) or (recipient=auth.uid() and requester=p_user))) then raise exception 'INVALID_FRIEND'; end if;
  if (select count(*) from game_private.invites where sender=auth.uid() and created_at>now()-interval '1 minute')>=3 then raise exception 'RATE_LIMIT'; end if;
  room:=public.create_room(p_category,false);
  insert into game_private.invites(sender,recipient,room_id) values(auth.uid(),p_user,(room->>'id')::uuid);
  return room;
end;
$$;
create function public.accept_invite(p_invite uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare code text; room jsonb;
begin
  select r.code into code from game_private.invites i join public.rooms r on r.id=i.room_id where i.id=p_invite and i.recipient=auth.uid() and i.created_at>now()-interval '15 minutes';
  if code is null then raise exception 'INVALID_INVITE'; end if;
  room:=public.join_room(code,null);
  delete from game_private.invites where id=p_invite;
  return room;
end;
$$;
revoke all on function public.request_friend(text),public.respond_friend(uuid,boolean),public.remove_friend(uuid),public.get_friends(),public.invite_friend(uuid,text),public.accept_invite(uuid) from public,anon;
grant execute on function public.request_friend(text),public.respond_friend(uuid,boolean),public.remove_friend(uuid),public.get_friends(),public.invite_friend(uuid,text),public.accept_invite(uuid) to authenticated;
