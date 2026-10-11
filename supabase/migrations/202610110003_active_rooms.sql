create function public.list_my_rooms() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.rooms where auth.uid() in (host_id, guest_id) and status != 'finished' order by created_at desc limit 10) r), '[]'::jsonb);
end;
$$;
revoke all on function public.list_my_rooms() from public, anon;
grant execute on function public.list_my_rooms() to authenticated;
