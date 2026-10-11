do $$
declare p record; candidate text; suffix integer;
begin
  for p in select id,username from (select id,username,row_number() over(partition by lower(trim(username)) order by created_at,id) as position from public.profiles) names where position>1 loop
    suffix:=0;
    loop
      candidate:=left(trim(p.username),13)||'_'||left(replace(p.id::text,'-',''),8)||case when suffix=0 then '' else suffix::text end;
      exit when not exists(select 1 from public.profiles where lower(trim(username))=lower(candidate));
      suffix:=suffix+1;
    end loop;
    update public.profiles set username=candidate where id=p.id;
  end loop;
end $$;
create unique index profiles_unique_username on public.profiles(lower(trim(username)));
create or replace function public.ensure_profile(p_username text default 'Detective') returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; candidate text; base text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into p from public.profiles where id=auth.uid();
  if p.id is not null then return to_jsonb(p); end if;
  base:=left(coalesce(nullif(trim(p_username),''),'Detective'),24);
  if length(base)<2 then base:='Detective'; end if;
  candidate:=base;
  loop
    begin
      insert into public.profiles(id,username) values(auth.uid(),candidate) on conflict(id) do nothing;
      exit;
    exception when unique_violation then
      candidate:=left(base,15)||'_'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
    end;
  end loop;
  select * into p from public.profiles where id=auth.uid();
  return to_jsonb(p);
end $$;
create or replace function public.update_profile(p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; n text:=trim(p_username);
begin
  if n is null or length(n) not between 2 and 24 or n ~ '[[:cntrl:]]' then raise exception 'INVALID_NAME'; end if;
  begin
    update public.profiles set username=n where id=auth.uid() returning * into p;
  exception when unique_violation then raise exception 'USERNAME_TAKEN'; end;
  if p.id is null then raise exception 'UNAUTHORIZED'; end if;
  update public.rooms set host_name=n where host_id=p.id and status!='finished';
  update public.rooms set guest_name=n where guest_id=p.id and status!='finished';
  return to_jsonb(p);
end $$;
alter table public.profiles add column staff_badge text check(staff_badge in ('CEO','Co-CEO'));
alter table public.profiles add column draws integer not null default 0;
alter table public.rooms add column outcome text check(outcome in ('win','draw','cancelled'));
alter table public.rooms add column pending_winner uuid references public.profiles(id);
update public.rooms set outcome=case when winner_id is null then 'cancelled' else 'win' end where status='finished';

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
    score:=case when p_winner is null then 0.5 when p_winner=r.host_id then 1 else 0 end;
    delta:=round(32*(score-1/(1+power(10::numeric,(g.rating-h.rating)::numeric/400))))::integer;
    if p_winner=r.host_id then delta:=greatest(1,delta); elsif p_winner=r.guest_id then delta:=least(-1,delta); end if;
    delta:=greatest(-h.rating,least(g.rating,delta));
    changes:=jsonb_build_object(r.host_id::text,delta,r.guest_id::text,-delta);
    update public.profiles set rating=rating+case when id=r.host_id then delta else -delta end,rated_games=rated_games+1 where id in(r.host_id,r.guest_id);
    if p_winner is not null and not p_forfeit then
      update public.profiles set category_wins=jsonb_set(category_wins,array[r.category],to_jsonb(coalesce((category_wins->>r.category)::integer,0)+1)) where id=p_winner;
      if (select count(*) from public.rooms where winner_id=p_winner and finished_at>now()-interval '24 hours')<20 then reward:=50; end if;
    end if;
  end if;
  update public.rooms set status='finished',outcome=case when p_winner is null then 'draw' else 'win' end,winner_id=p_winner,turn_id=null,pending_winner=null,finished_at=now(),rating_changes=changes where id=p_room;
  update public.profiles set games=games+1,wins=wins+case when id=p_winner then 1 else 0 end,draws=draws+case when p_winner is null then 1 else 0 end,coins=coins+case when id=p_winner then reward else 0 end where id in(r.host_id,r.guest_id);
  return jsonb_build_object('winner_id',p_winner,'reward',reward,'rating_changes',changes,'draw',p_winner is null);
end $$;
create or replace function public.pass_turn(p_room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id) for update;
  if r.id is null or r.status!='playing' or r.turn_id!=auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  if r.pending_winner is not null then raise exception 'FINAL_GUESS_REQUIRED'; end if;
  update public.rooms set turn_id=case when host_id=auth.uid() then guest_id else host_id end,moves=moves+1 where id=p_room;
end $$;
create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id=p_room and auth.uid() in(host_id,guest_id) for update;
  if r.id is null then raise exception 'ROOM_NOT_FOUND'; end if;
  if r.status='finished' then return; end if;
  if r.status='playing' then
    perform game_private.complete_match(p_room,case when r.host_id=auth.uid() then r.guest_id else r.host_id end,true);
  else
    update public.rooms set status='finished',outcome='cancelled',finished_at=now() where id=p_room;
  end if;
end $$;
create function public.match_history(p_opponent uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total bigint; won bigint; drawn bigint; opponents jsonb; matches jsonb;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select count(*),count(*) filter(where winner_id=auth.uid()),count(*) filter(where outcome='draw') into total,won,drawn from public.rooms where status='finished' and outcome in('win','draw') and auth.uid() in(host_id,guest_id) and (p_opponent is null or p_opponent in(host_id,guest_id));
  select coalesce(jsonb_agg(to_jsonb(p)),'[]') into opponents from (select distinct p.id,p.username from public.rooms r join public.profiles p on p.id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end where auth.uid() in(r.host_id,r.guest_id) and r.outcome in('win','draw') order by p.username) p;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into matches from (select r.id,r.category,r.finished_at,r.outcome,r.winner_id,p.username as opponent_name,p.id as opponent_id,r.rating_changes->>auth.uid()::text as rating_change from public.rooms r join public.profiles p on p.id=case when r.host_id=auth.uid() then r.guest_id else r.host_id end where auth.uid() in(r.host_id,r.guest_id) and r.outcome in('win','draw') and (p_opponent is null or p.id=p_opponent) order by r.finished_at desc limit 30) m;
  return jsonb_build_object('games',total,'wins',won,'draws',drawn,'losses',total-won-drawn,'opponents',opponents,'matches',matches);
end $$;
revoke all on function public.match_history(uuid) from public,anon;
grant execute on function public.match_history(uuid) to authenticated;
