-- Block exact duplicate inventory names across all statuses. No stock is merged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.normalized_inventory_item_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog
AS $$ SELECT lower(btrim(regexp_replace(replace(p_name,chr(160),' '),'[[:space:]]+',' ','g'))) $$;
-- Prevent a concurrent insert from racing the audit and index creation.
LOCK TABLE public.inventory IN SHARE ROW EXCLUSIVE MODE;
DO $audit$
BEGIN
  IF EXISTS(SELECT 1 FROM public.inventory WHERE item_name IS NULL OR public.normalized_inventory_item_name(item_name)='') THEN
    RAISE EXCEPTION 'Inventory contains blank item names. Review those items before installing uniqueness protection.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.inventory GROUP BY public.normalized_inventory_item_name(item_name) HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate inventory names exist. Review SELECT public.normalized_inventory_item_name(item_name), array_agg(item_id) FROM public.inventory GROUP BY 1 HAVING count(*)>1; No items were changed.';
  END IF;
END
$audit$;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_item_name_normalized_unique
ON public.inventory(public.normalized_inventory_item_name(item_name));
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_name_not_blank;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_name_not_blank
CHECK(item_name IS NOT NULL AND public.normalized_inventory_item_name(item_name)<>'');
NOTIFY pgrst, 'reload schema';
COMMIT;
