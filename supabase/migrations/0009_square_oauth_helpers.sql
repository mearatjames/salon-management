-- 0009_square_oauth_helpers.sql
-- Single-transaction wrappers around pgcrypto encrypt/decrypt so PostgREST
-- callers don't need to chain set_config + crypto across separate RPC calls
-- (the app.square_oauth_key GUC is transaction-local). Both functions read
-- the symmetric key from Supabase Vault inside their own body, set the GUC
-- locally, and do the work atomically.

create or replace function public.encrypt_square_token(plain text, vault_secret_name text)
returns bytea
language plpgsql
security definer
set search_path = public, pg_temp, vault, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = vault_secret_name;
  if v_key is null then
    raise exception 'vault_secret_not_found: %', vault_secret_name using errcode = '42704';
  end if;
  perform set_config('app.square_oauth_key', v_key, true);
  return pgp_sym_encrypt(plain, current_setting('app.square_oauth_key'));
end;
$$;
revoke all on function public.encrypt_square_token(text, text) from public;
grant execute on function public.encrypt_square_token(text, text) to service_role;

create or replace function public.read_square_oauth_decrypted(vault_secret_name text)
returns table (
  merchant_id text,
  merchant_name text,
  access_token text,
  refresh_token text,
  access_token_expires_at timestamptz,
  scope text,
  connected_at timestamptz,
  connected_by_staff_id uuid,
  refresh_failed_at timestamptz,
  last_refreshed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp, vault, extensions
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = vault_secret_name;
  if v_key is null then
    raise exception 'vault_secret_not_found: %', vault_secret_name using errcode = '42704';
  end if;
  perform set_config('app.square_oauth_key', v_key, true);
  return query
    select o.merchant_id,
           o.merchant_name,
           pgp_sym_decrypt(o.access_token_encrypted, current_setting('app.square_oauth_key'))::text,
           pgp_sym_decrypt(o.refresh_token_encrypted, current_setting('app.square_oauth_key'))::text,
           o.access_token_expires_at,
           o.scope,
           o.connected_at,
           o.connected_by_staff_id,
           o.refresh_failed_at,
           o.last_refreshed_at
    from public.square_oauth o
    where o.id is true;
end;
$$;
revoke all on function public.read_square_oauth_decrypted(text) from public;
grant execute on function public.read_square_oauth_decrypted(text) to service_role;
