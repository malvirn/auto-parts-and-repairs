-- Normalize phone numbers with an explicit digit-only expression.
-- The preceding migration already contains the corrected expression on clean installs.
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.redeem_credit_voucher(text,numeric,text,uuid,uuid)'::regprocedure);
 definition:=replace(definition,chr(92)||chr(92)||'D','[^0-9]');
 execute definition;
end $$;
