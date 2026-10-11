alter table public.profiles add column streak_count integer not null default 0;
alter table public.profiles add column streak_best integer not null default 0;
alter table public.profiles add column streak_day date;
create table game_private.daily_activity(user_id uuid not null references public.profiles(id),day date not null,streak integer not null,coins integer not null,gift text,primary key(user_id,day));
create table game_private.practice_tickets(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),category text not null,created_at timestamptz not null default now(),completed_at timestamptz,outcome text check(outcome in('win','loss','draw')));
revoke all on game_private.daily_activity,game_private.practice_tickets from public,anon,authenticated;
create function game_private.record_daily_match(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles; today date:=(now() at time zone 'Asia/Almaty')::date; days integer; reward integer:=25; gift text;
begin
  select * into p from public.profiles where id=p_user for update;
  if p.id is null or p.streak_day=today or exists(select 1 from game_private.daily_activity where user_id=p_user and day=today) then return; end if;
  days:=case when p.streak_day=today-1 then p.streak_count+1 else 1 end;
  if days=3 then reward:=75;
  elsif days=7 then reward:=150;gift:='emoji-fire';
  elsif days=14 then reward:=300;gift:='frame-lime';
  elsif days=30 then reward:=750;gift:='frame-gold';
  elsif days>30 and days%7=0 then reward:=225; end if;
  insert into game_private.daily_activity values(p_user,today,days,reward,gift);
  update public.profiles set streak_count=days,streak_best=greatest(streak_best,days),streak_day=today,coins=coins+reward,owned=case when gift is not null and not(gift=any(owned)) then array_append(owned,gift) else owned end where id=p_user;
end $$;
revoke all on function game_private.record_daily_match(uuid) from public,anon,authenticated;
create function public.streak_status() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; today date:=(now() at time zone 'Asia/Almaty')::date;
begin
  select * into p from public.profiles where id=auth.uid();
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  return jsonb_build_object('count',case when p.streak_day>=today-1 then p.streak_count else 0 end,'best',p.streak_best,'lit',coalesce(p.streak_day=today,false),'today',today,'last_day',p.streak_day,'timezone','UTC+5','reward',(select jsonb_build_object('coins',coins,'gift',gift) from game_private.daily_activity where user_id=p.id and day=today),'recent',coalesce((select jsonb_agg(day order by day) from game_private.daily_activity where user_id=p.id and day>=today-6),'[]'::jsonb));
end $$;
create function public.start_practice_streak(p_category text) returns uuid
language plpgsql security definer set search_path='' as $$
declare ticket uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists(select 1 from public.decks where id=p_category and (published or owner_id=auth.uid())) then raise exception 'DECK_NOT_FOUND'; end if;
  select id into ticket from game_private.practice_tickets where user_id=auth.uid() and category=p_category and completed_at is null and created_at>now()-interval '1 day' order by created_at desc limit 1;
  if ticket is null then insert into game_private.practice_tickets(user_id,category) values(auth.uid(),p_category) returning id into ticket; end if;
  return ticket;
end $$;
create function public.finish_practice_streak(p_ticket uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ticket game_private.practice_tickets;
begin
  if p_outcome is null or p_outcome not in('win','loss','draw') then raise exception 'INVALID_RESULT'; end if;
  select * into ticket from game_private.practice_tickets where id=p_ticket and user_id=auth.uid() for update;
  if ticket.id is null then raise exception 'INVALID_TICKET'; end if;
  if ticket.completed_at is null then
    if ticket.created_at<now()-interval '7 days' then raise exception 'INVALID_TICKET'; end if;
    update game_private.practice_tickets set completed_at=now(),outcome=p_outcome where id=p_ticket;
    perform game_private.record_daily_match(auth.uid());
  end if;
  return public.streak_status();
end $$;
revoke all on function public.streak_status(),public.start_practice_streak(text),public.finish_practice_streak(uuid,text) from public,anon;
grant execute on function public.streak_status(),public.start_practice_streak(text),public.finish_practice_streak(uuid,text) to authenticated;

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
  if not p_forfeit then perform game_private.record_daily_match(r.host_id); perform game_private.record_daily_match(r.guest_id); end if;
  return jsonb_build_object('winner_id',p_winner,'reward',reward,'rating_changes',changes,'draw',p_winner is null);
end $$;
