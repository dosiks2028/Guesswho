alter table public.profiles add column rating integer not null default 1000;
alter table public.profiles add column rated_games integer not null default 0;
alter table public.profiles add column category_wins jsonb not null default '{}'::jsonb;
alter table public.profiles add column title text not null default 'rookie';
alter table public.rooms add column rating_changes jsonb not null default '{}'::jsonb;
update public.profiles p set category_wins = coalesce((select jsonb_object_agg(category,total) from (select category,count(*) as total from public.rooms where winner_id=p.id and status='finished' and moves>=2 and finished_at-started_at>=interval '30 seconds' group by category) counts),'{}'::jsonb);

create function game_private.title_unlocked(p public.profiles, p_title text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_title
    when 'rookie' then true
    when 'first-case' then p.wins>=1
    when 'senpai' then coalesce((p.category_wins->>'naruto')::integer,0)+coalesce((p.category_wins->>'attack-on-titan')::integer,0)>=5
    when 'sensei' then coalesce((p.category_wins->>'naruto')::integer,0)+coalesce((p.category_wins->>'attack-on-titan')::integer,0)>=15
    when 'anime-legend' then coalesce((p.category_wins->>'naruto')::integer,0)+coalesce((p.category_wins->>'attack-on-titan')::integer,0)>=30
    when 'wizard' then coalesce((p.category_wins->>'harry-potter')::integer,0)>=5
    when 'archmage' then coalesce((p.category_wins->>'harry-potter')::integer,0)>=20
    when 'avenger' then coalesce((p.category_wins->>'avengers')::integer,0)>=5
    when 'multiverse' then coalesce((p.category_wins->>'avengers')::integer,0)>=20
    when 'sherlock' then p.wins>=10
    when 'mastermind' then p.wins>=50
    when 'worldwalker' then coalesce((p.category_wins->>'naruto')::integer,0)>=5 and coalesce((p.category_wins->>'attack-on-titan')::integer,0)>=5 and coalesce((p.category_wins->>'harry-potter')::integer,0)>=5 and coalesce((p.category_wins->>'avengers')::integer,0)>=5
    else false end
$$;
revoke all on function game_private.title_unlocked(public.profiles,text) from public,anon,authenticated;

create function public.equip_title(p_title text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id=auth.uid() for update;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  if not game_private.title_unlocked(p,p_title) then raise exception 'NOT_OWNED'; end if;
  update public.profiles set title=p_title where id=p.id returning * into p;
  return to_jsonb(p);
end;
$$;
revoke all on function public.equip_title(text) from public,anon;
grant execute on function public.equip_title(text) to authenticated;

create function public.leaderboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(p)) from (select id,username,rating,rated_games,wins,title,frame from public.profiles where rated_games>0 order by rating desc,wins desc,id limit 50) p),'[]'::jsonb);
end;
$$;
revoke all on function public.leaderboard() from public,anon;
grant execute on function public.leaderboard() to authenticated;

create function game_private.complete_match(p_room uuid,p_winner uuid,p_forfeit boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; w public.profiles; l public.profiles; loser uuid; delta integer:=0; reward integer:=0; eligible boolean; changes jsonb:='{}'::jsonb;
begin
  select * into r from public.rooms where id=p_room for update;
  if r.status!='playing' or p_winner not in (r.host_id,r.guest_id) then raise exception 'INVALID_STATE'; end if;
  loser:=case when r.host_id=p_winner then r.guest_id else r.host_id end;
  perform id from public.profiles where id in (p_winner,loser) order by id for update;
  select * into w from public.profiles where id=p_winner;
  select * into l from public.profiles where id=loser;
  eligible:=r.moves>=2 and r.started_at<now()-interval '30 seconds';
  if eligible then
    delta:=greatest(1,round(32*(1-1/(1+power(10::numeric,(l.rating-w.rating)::numeric/400))))::integer);
    changes:=jsonb_build_object(p_winner::text,delta,loser::text,-least(delta,l.rating));
    update public.profiles set rating=case when id=p_winner then rating+delta else greatest(0,rating-delta) end,rated_games=rated_games+1 where id in (p_winner,loser);
    if not p_forfeit then
      update public.profiles set category_wins=jsonb_set(category_wins,array[r.category],to_jsonb(coalesce((category_wins->>r.category)::integer,0)+1)) where id=p_winner;
      if (select count(*) from public.rooms where winner_id=p_winner and finished_at>now()-interval '24 hours')<20 then reward:=50; end if;
    end if;
  end if;
  update public.rooms set status='finished',winner_id=p_winner,finished_at=now(),rating_changes=changes where id=p_room;
  update public.profiles set games=games+1,wins=wins+case when id=p_winner then 1 else 0 end,coins=coins+case when id=p_winner then reward else 0 end where id in (p_winner,loser);
  return jsonb_build_object('correct',true,'winner_id',p_winner,'reward',reward,'rating_changes',changes);
end;
$$;
revoke all on function game_private.complete_match(uuid,uuid,boolean) from public,anon,authenticated;

create or replace function public.guess_character(p_room uuid,p_character text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; opponent uuid; target text;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in (host_id,guest_id) for update;
  if r.id is null or r.status!='playing' or r.turn_id!=auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  if not exists(select 1 from game_private.characters where id=p_character and category=r.category) then raise exception 'INVALID_CHARACTER'; end if;
  opponent:=case when r.host_id=auth.uid() then r.guest_id else r.host_id end;
  select character_id into target from game_private.secrets where room_id=p_room and user_id=opponent;
  if target!=p_character then
    update public.rooms set turn_id=opponent,moves=moves+1 where id=p_room;
    return jsonb_build_object('correct',false,'winner_id',null,'reward',0);
  end if;
  return game_private.complete_match(p_room,auth.uid(),false);
end;
$$;
create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in (host_id,guest_id) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status='finished' then return; end if;
  if r.status='playing' then
    perform game_private.complete_match(p_room,case when r.host_id=auth.uid() then r.guest_id else r.host_id end,true);
  else
    update public.rooms set status='finished',finished_at=now() where id=p_room;
  end if;
end;
$$;
