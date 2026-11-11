-- Notifications become translatable: title/message hold English templates with {placeholders},
-- `params` holds the values. Existing rows (stored as finished English text) are converted.
ALTER TABLE "notifications" ADD COLUMN "params" JSONB;

-- The table has FORCE ROW LEVEL SECURITY; the backfill runs across all tenants.
SET app.bypass_rls = 'on';

UPDATE "notifications" SET
  "params" = jsonb_build_object('n', (regexp_match("title", '^(\d+) lot\(s\) expire within 24 hours$'))[1],
                                'kg', (regexp_match("message", '^(.+) must be sold or allocated today \(FEFO\)\.$'))[1]),
  "title" = '{n} lot(s) expire within 24 hours',
  "message" = '{kg} must be sold or allocated today (FEFO).'
WHERE "params" IS NULL AND "title" ~ '^\d+ lot\(s\) expire within 24 hours$' AND "message" ~ '^.+ must be sold or allocated today \(FEFO\)\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('n', (regexp_match("title", '^(\d+) expired lot\(s\) still in stock$'))[1],
                                'kg', (regexp_match("message", '^(.+) has passed its expiry date and must be written off\.$'))[1]),
  "title" = '{n} expired lot(s) still in stock',
  "message" = '{kg} has passed its expiry date and must be written off.'
WHERE "params" IS NULL AND "title" ~ '^\d+ expired lot\(s\) still in stock$' AND "message" ~ '^.+ has passed its expiry date and must be written off\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('product', (regexp_match("title", '^Low stock: (.+)$'))[1],
                                'free', (regexp_match("message", '^Free stock (.+) is below the minimum of (.+)\.$'))[1],
                                'min', (regexp_match("message", '^Free stock (.+) is below the minimum of (.+)\.$'))[2]),
  "title" = 'Low stock: {product}',
  "message" = 'Free stock {free} is below the minimum of {min}.'
WHERE "params" IS NULL AND "title" ~ '^Low stock: .+$' AND "message" ~ '^Free stock .+ is below the minimum of .+\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('number', (regexp_match("title", '^Overdue invoice (\S+) — (.+)$'))[1],
                                'customer', (regexp_match("title", '^Overdue invoice (\S+) — (.+)$'))[2],
                                'amount', replace(to_char((regexp_match("message", '^Outstanding (-?\d+) UZS, due (\d{4}-\d{2}-\d{2})\.$'))[1]::numeric, 'FM999,999,999,999,990'), ',', ' '),
                                'date', to_char(to_date((regexp_match("message", '^Outstanding (-?\d+) UZS, due (\d{4}-\d{2}-\d{2})\.$'))[2], 'YYYY-MM-DD'), 'DD.MM.YYYY')),
  "title" = 'Overdue invoice {number} — {customer}',
  "message" = 'Outstanding {amount} UZS, due {date}.'
WHERE "params" IS NULL AND "title" ~ '^Overdue invoice \S+ — .+$' AND "message" ~ '^Outstanding -?\d+ UZS, due \d{4}-\d{2}-\d{2}\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('name', (regexp_match("title", '^Driver licence expiring: (.+)$'))[1],
                                'licence', (regexp_match("message", '^Licence (.*) expires (\d{4}-\d{2}-\d{2})\.$'))[1],
                                'date', to_char(to_date((regexp_match("message", '^Licence (.*) expires (\d{4}-\d{2}-\d{2})\.$'))[2], 'YYYY-MM-DD'), 'DD.MM.YYYY')),
  "title" = 'Driver licence expiring: {name}',
  "message" = 'Licence {licence} expires {date}.'
WHERE "params" IS NULL AND "title" ~ '^Driver licence expiring: .+$' AND "message" ~ '^Licence .* expires \d{4}-\d{2}-\d{2}\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('label', (regexp_match("title", '^Temperature excursion: (.+)$'))[1],
                                'temp', (regexp_match("message", '^(.+) °C recorded \((manual|device|demo) reading\), allowed (.+) … (.+) °C\.$'))[1],
                                'min', (regexp_match("message", '^(.+) °C recorded \((manual|device|demo) reading\), allowed (.+) … (.+) °C\.$'))[3],
                                'max', (regexp_match("message", '^(.+) °C recorded \((manual|device|demo) reading\), allowed (.+) … (.+) °C\.$'))[4]),
  "title" = 'Temperature excursion: {label}',
  "message" = '{temp} °C recorded (' || (regexp_match("message", '^(.+) °C recorded \((manual|device|demo) reading\), allowed (.+) … (.+) °C\.$'))[2] || ' reading), allowed {min} … {max} °C.'
WHERE "params" IS NULL AND "title" ~ '^Temperature excursion: .+$' AND "message" ~ '^.+ °C recorded \((manual|device|demo) reading\), allowed .+ … .+ °C\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('number', (regexp_match("title", '^Unexplained mass difference in shift (\S+)$'))[1],
                                'kg', (regexp_match("message", '^(\S+) kg \((\S+)%\) of input weight is not accounted for by outputs or waste \(tolerance (\S+)%\)\.$'))[1],
                                'pct', (regexp_match("message", '^(\S+) kg \((\S+)%\) of input weight is not accounted for by outputs or waste \(tolerance (\S+)%\)\.$'))[2],
                                'tol', (regexp_match("message", '^(\S+) kg \((\S+)%\) of input weight is not accounted for by outputs or waste \(tolerance (\S+)%\)\.$'))[3]),
  "title" = 'Unexplained mass difference in shift {number}',
  "message" = '{kg} kg ({pct}%) of input weight is not accounted for by outputs or waste (tolerance {tol}%).'
WHERE "params" IS NULL AND "title" ~ '^Unexplained mass difference in shift \S+$' AND "message" ~ '^\S+ kg \(\S+%\) of input weight is not accounted for by outputs or waste \(tolerance \S+%\)\.$';

UPDATE "notifications" SET
  "params" = jsonb_build_object('number', (regexp_match("title", '^Non-conformity (\S+): (.*)$'))[1], 'title', (regexp_match("title", '^Non-conformity (\S+): (.*)$'))[2], 'text', "message"),
  "title" = 'Non-conformity {number}: {title}',
  "message" = '{text}'
WHERE "params" IS NULL AND "type" = 'NONCONFORMITY' AND "title" ~ '^Non-conformity \S+: ';

UPDATE "notifications" SET
  "params" = jsonb_build_object('supplier', (regexp_match("title", '^(Delivery rejected|Delivery partially accepted): (.*)$'))[2],
                                'number', (regexp_match("message", '^(\S+) \((\S+)\) — (.*)$'))[1],
                                'code', (regexp_match("message", '^(\S+) \((\S+)\) — (.*)$'))[2],
                                'reason', (regexp_match("message", '^(\S+) \((\S+)\) — (.*)$'))[3]),
  "title" = (regexp_match("title", '^(Delivery rejected|Delivery partially accepted): (.*)$'))[1] || ': {supplier}',
  "message" = '{number} ({code}) — {reason}'
WHERE "params" IS NULL AND "title" ~ '^(Delivery rejected|Delivery partially accepted): ' AND "message" ~ '^\S+ \(\S+\) — ';

UPDATE "notifications" SET
  "params" = jsonb_build_object('number', (regexp_match("title", '^Recall (\S+) initiated for batch (\S+)$'))[1], 'code', (regexp_match("title", '^Recall (\S+) initiated for batch (\S+)$'))[2], 'text', "message"),
  "title" = 'Recall {number} initiated for batch {code}',
  "message" = '{text}'
WHERE "params" IS NULL AND "type" = 'RECALL' AND "title" ~ '^Recall \S+ initiated for batch \S+$';

RESET app.bypass_rls;
