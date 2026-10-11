create or replace function public.get_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare friends jsonb; incoming jsonb; outgoing jsonb; invites jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating,'friend_code',p.friend_code) order by p.username),'[]'::jsonb) into friends from game_private.friendships f join public.profiles p on p.id=case when f.requester=auth.uid() then f.recipient else f.requester end where auth.uid() in(f.requester,f.recipient) and f.status='accepted';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating)),'[]'::jsonb) into incoming from game_private.friendships f join public.profiles p on p.id=f.requester where f.recipient=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating)),'[]'::jsonb) into outgoing from game_private.friendships f join public.profiles p on p.id=f.recipient where f.requester=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'username',p.username,'category',r.category,'category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn','room_id',r.id)),'[]'::jsonb) into invites from game_private.invites i join public.profiles p on p.id=i.sender join public.rooms r on r.id=i.room_id where i.recipient=auth.uid() and i.created_at>now()-interval '15 minutes' and r.status='waiting';
  return jsonb_build_object('friends',friends,'incoming',incoming,'outgoing',outgoing,'invites',invites);
end;
$$;
create or replace function public.leaderboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from (select id,username,rating,rated_games,wins,title,frame,avatar,staff_badge from public.profiles where rated_games>0 order by rating desc,wins desc,id limit 50) p),'[]'::jsonb);
end;
$$;
create or replace function public.list_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg((to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn'))-'code') from (select r.*,p.avatar as host_avatar,p.title as host_title,p.rating as host_rating,p.frame as host_frame,p.staff_badge as host_staff_badge from public.rooms r join public.profiles p on p.id=r.host_id where r.is_public and r.status='waiting' and r.created_at>now()-interval '2 hours' order by r.created_at desc limit 50) r),'[]'::jsonb);
end;
$$;
