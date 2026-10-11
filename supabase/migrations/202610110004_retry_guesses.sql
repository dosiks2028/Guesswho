create or replace function public.guess_character(p_room uuid, p_character text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms; opponent uuid; target text; winner uuid; reward integer := 0;
begin
  select * into r from public.rooms where id = p_room and auth.uid() in (host_id, guest_id) for update;
  if r.id is null or r.status != 'playing' or r.turn_id != auth.uid() then raise exception 'NOT_YOUR_TURN'; end if;
  if not exists (select 1 from game_private.characters where id = p_character and category = r.category) then raise exception 'INVALID_CHARACTER'; end if;
  opponent := case when r.host_id = auth.uid() then r.guest_id else r.host_id end;
  select character_id into target from game_private.secrets where room_id = p_room and user_id = opponent;
  if target != p_character then
    update public.rooms set turn_id = opponent, moves = moves + 1 where id = p_room;
    return jsonb_build_object('correct',false,'winner_id',null,'reward',0);
  end if;
  winner := auth.uid();
  if r.moves >= 2 and r.started_at < now() - interval '30 seconds' and (select count(*) from public.rooms where winner_id = winner and finished_at > now() - interval '24 hours') < 20 then reward := 50; end if;
  update public.rooms set status = 'finished', winner_id = winner, finished_at = now() where id = p_room;
  update public.profiles set games = games + 1, wins = wins + case when id = winner then 1 else 0 end, coins = coins + case when id = winner then reward else 0 end where id in (r.host_id, r.guest_id);
  return jsonb_build_object('correct',true,'winner_id',winner,'reward',reward);
end;
$$;
