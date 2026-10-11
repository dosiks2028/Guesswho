alter table public.rooms add column is_ranked boolean not null default true;
create table game_private.boards(room_id uuid not null references public.rooms(id) on delete cascade,user_id uuid not null references public.profiles(id),closed text[] not null default '{}',version bigint not null default 0,primary key(room_id,user_id));
revoke all on game_private.boards from public,anon,authenticated;
create function public.set_board(p_room uuid,p_closed jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; cards text[]; b game_private.boards;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status!='playing' then raise exception 'INVALID_STATE'; end if;
  if p_closed is null or jsonb_typeof(p_closed)!='array' then raise exception 'INVALID_BOARD'; end if;
  if jsonb_array_length(p_closed)>64 or exists(select 1 from jsonb_array_elements(p_closed) c where jsonb_typeof(c)!='string') then raise exception 'INVALID_BOARD'; end if;
  select coalesce(array_agg(distinct c),'{}') into cards from jsonb_array_elements_text(p_closed) c;
  if exists(select 1 from unnest(cards) c where not game_private.room_has_character(r,c)) then raise exception 'INVALID_CHARACTER'; end if;
  insert into game_private.boards(room_id,user_id,closed,version) values(p_room,auth.uid(),cards,1) on conflict(room_id,user_id) do update set closed=excluded.closed,version=game_private.boards.version+1 returning * into b;
  return jsonb_build_object('closed',b.closed,'version',b.version);
end $$;


create or replace function public.create_room(p_category text,p_public boolean,p_ranked boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; n text; pack jsonb;
begin
  select username into n from public.profiles where id=auth.uid() for update;
  if n is null then raise exception 'UNAUTHORIZED'; end if;
  select data into pack from public.decks where id=p_category and (published or owner_id=auth.uid());
  if pack is null then raise exception 'DECK_NOT_FOUND'; end if;
  if (select count(*) from public.rooms where host_id=auth.uid() and status!='finished' and created_at>now()-interval '2 hours')>=3 then raise exception 'ROOM_LIMIT'; end if;
  insert into public.rooms(category,host_id,host_name,is_public,deck,is_ranked) values(p_category,auth.uid(),n,p_public,pack,p_ranked) returning * into r;
  return to_jsonb(r)-'deck';
end $$;

create or replace function game_private.complete_match(p_room uuid,p_winner uuid,p_forfeit boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.rooms; h public.profiles; g public.profiles; delta integer:=0; reward integer:=0; eligible boolean; score numeric; changes jsonb:='{}';
begin
  select * into r from public.rooms where id=p_room for update;
  if r.id is null or r.status!='playing' or (p_winner is not null and p_winner not in (r.host_id,r.guest_id)) then raise exception 'INVALID_STATE'; end if;
  perform id from public.profiles where id in (r.host_id,r.guest_id) order by id for update;
  select * into h from public.profiles where id=r.host_id;
  select * into g from public.profiles where id=r.guest_id;
  eligible:=r.moves>=2 and r.started_at<now()-interval '30 seconds';
  if eligible then
    if r.is_ranked then
    score:=case when p_winner is null then 0.5 when p_winner=r.host_id then 1 else 0 end;
    delta:=round(32*(score-1/(1+power(10::numeric,(g.rating-h.rating)::numeric/400))))::integer;
    if p_winner=r.host_id then delta:=greatest(1,delta); elsif p_winner=r.guest_id then delta:=least(-1,delta); end if;
    delta:=greatest(-h.rating,least(g.rating,delta));
    changes:=jsonb_build_object(r.host_id::text,delta,r.guest_id::text,-delta);
    update public.profiles set rating=rating+case when id=r.host_id then delta else -delta end,rated_games=rated_games+1 where id in(r.host_id,r.guest_id);
    end if;
    if p_winner is not null and not p_forfeit then
      update public.profiles set category_wins=jsonb_set(category_wins,array[r.category],to_jsonb(coalesce((category_wins->>r.category)::integer,0)+1)) where id=p_winner;
      if (select count(*) from public.rooms where winner_id=p_winner and finished_at>now()-interval '24 hours')<20 then reward:=50; end if;
    end if;
  end if;
  update public.rooms set status='finished',outcome=case when p_winner is null then 'draw' else 'win' end,winner_id=p_winner,turn_id=null,pending_winner=null,finished_at=now(),rating_changes=changes where id=p_room;
  update public.profiles set games=games+1,wins=wins+case when id=p_winner then 1 else 0 end,draws=draws+case when p_winner is null then 1 else 0 end,coins=coins+case when id=p_winner then reward else 0 end where id in(r.host_id,r.guest_id);
  return jsonb_build_object('winner_id',p_winner,'reward',reward,'rating_changes',changes,'draw',p_winner is null);
end $$;

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
  return jsonb_build_object('room',(to_jsonb(r)-'deck'||jsonb_build_object('category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn')),'secret',s,'messages',m,'players',players,'own_closed',(select to_jsonb(closed) from game_private.boards where room_id=p_room and user_id=auth.uid()),'own_board_version',coalesce((select version from game_private.boards where room_id=p_room and user_id=auth.uid()),0),'opponent_closed',coalesce((select to_jsonb(closed) from game_private.boards where room_id=p_room and user_id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end),'[]'::jsonb));
end;
$$;

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
  if not correct then
    insert into game_private.boards(room_id,user_id,closed,version) values(p_room,auth.uid(),array[p_character],1) on conflict(room_id,user_id) do update set closed=case when p_character=any(game_private.boards.closed) then game_private.boards.closed else array_append(game_private.boards.closed,p_character) end,version=game_private.boards.version+1;
  end if;
  if r.pending_winner is not null then
    result:=game_private.complete_match(p_room,case when correct then null else r.pending_winner end,false);
    return result||jsonb_build_object('correct',correct);
  end if;
  update public.rooms set turn_id=opponent,moves=moves+1,pending_winner=case when correct then auth.uid() else null end where id=p_room;
  return jsonb_build_object('correct',correct,'last_chance',correct,'winner_id',null,'reward',0);
end $$;

create function public.invite_friend(p_user uuid,p_category text,p_ranked boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare room jsonb;
begin
  if not exists(select 1 from game_private.friendships where status='accepted' and ((requester=auth.uid() and recipient=p_user) or (recipient=auth.uid() and requester=p_user))) then raise exception 'INVALID_FRIEND'; end if;
  if (select count(*) from game_private.invites where sender=auth.uid() and created_at>now()-interval '1 minute')>=3 then raise exception 'RATE_LIMIT'; end if;
  room:=public.create_room(p_category,false,p_ranked);
  insert into game_private.invites(sender,recipient,room_id) values(auth.uid(),p_user,(room->>'id')::uuid);
  return room;
end;
$$;

create or replace function public.get_friends() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare friends jsonb; incoming jsonb; outgoing jsonb; invites jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating,'friend_code',p.friend_code) order by p.username),'[]'::jsonb) into friends from game_private.friendships f join public.profiles p on p.id=case when f.requester=auth.uid() then f.recipient else f.requester end where auth.uid() in(f.requester,f.recipient) and f.status='accepted';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating)),'[]'::jsonb) into incoming from game_private.friendships f join public.profiles p on p.id=f.requester where f.recipient=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'username',p.username,'avatar',p.avatar,'frame',p.frame,'title',p.title,'staff_badge',p.staff_badge,'rating',p.rating)),'[]'::jsonb) into outgoing from game_private.friendships f join public.profiles p on p.id=f.recipient where f.requester=auth.uid() and f.status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'username',p.username,'category',r.category,'category_title',r.deck->>'title','category_title_en',r.deck->>'titleEn','room_id',r.id,'is_ranked',r.is_ranked)),'[]'::jsonb) into invites from game_private.invites i join public.profiles p on p.id=i.sender join public.rooms r on r.id=i.room_id where i.recipient=auth.uid() and i.created_at>now()-interval '15 minutes' and r.status='waiting';
  return jsonb_build_object('friends',friends,'incoming',incoming,'outgoing',outgoing,'invites',invites);
end;
$$;

create or replace function public.match_history(p_opponent uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total bigint; won bigint; drawn bigint; opponents jsonb; matches jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select count(*),count(*) filter(where winner_id=auth.uid()),count(*) filter(where outcome='draw') into total,won,drawn from public.rooms where status='finished' and outcome in('win','draw') and auth.uid() in(host_id,guest_id) and (p_opponent is null or p_opponent in(host_id,guest_id));
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into opponents from (select distinct p.id,p.username from public.rooms r join public.profiles p on p.id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end where auth.uid() in(r.host_id,r.guest_id) and r.outcome in('win','draw') order by p.username) p;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into matches from (select r.id,r.category,r.is_ranked,r.finished_at,r.outcome,r.winner_id,p.username as opponent_name,p.id as opponent_id,r.rating_changes->>auth.uid()::text as rating_change from public.rooms r join public.profiles p on p.id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end where auth.uid() in(r.host_id,r.guest_id) and r.outcome in('win','draw') and (p_opponent is null or p.id=p_opponent) order by r.finished_at desc limit 30) m;
  return jsonb_build_object('games',total,'wins',won,'draws',drawn,'losses',total-won-drawn,'opponents',opponents,'matches',matches);
end $$;


revoke all on function public.set_board(uuid,jsonb),public.create_room(text,boolean,boolean),public.invite_friend(uuid,text,boolean) from public,anon;
grant execute on function public.set_board(uuid,jsonb),public.create_room(text,boolean,boolean),public.invite_friend(uuid,text,boolean) to authenticated;

