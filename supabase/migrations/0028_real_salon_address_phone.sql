-- 0028: Replace the placeholder salon address + phone with the real values.
--
-- Issue #152. Feature 013 (migration 0007) seeded `salon.address` and
-- `salon.phone` with San-Francisco placeholders. The receipt-preview masthead
-- reads these via `getSetting('salon.address')` / `getSetting('salon.phone')`,
-- so updating the stored settings flows through with no component change.
--
-- `salon.name` ("Tang Nails") is already correct and is left untouched.

update public.settings
  set value = to_jsonb('1157 E Clark Ave, Ste F, Santa Maria, CA 93455'::text)
  where key = 'salon.address';

update public.settings
  set value = to_jsonb('805-347-6863'::text)
  where key = 'salon.phone';
