-- Hand-written: views for derived data (2.2 §5). Nothing derivable is stored; statuses,
-- totals, balances and differences are computed here. Status values are English text
-- (docs/glosario.md, "Estados calculados en vistas"). The Drizzle definitions live in
-- src/db/schema/views.ts.
--
-- Shared rules:
--   * Business dates and the current period use America/Mexico_City (as folios do).
--   * A current role assignment has no end_date and an approved approval.
--   * Approval-dependent records (opening balance, cancellation, refund, adjustment) only
--     count once their approval is approved.

-- Date of a timestamp in the business time zone.
CREATE FUNCTION f_business_date(ts timestamptz) RETURNS date
  LANGUAGE sql STABLE
  RETURN (ts AT TIME ZONE 'America/Mexico_City')::date;
--> statement-breakpoint

-- First day of the current month in the business time zone.
CREATE FUNCTION f_current_period() RETURNS date
  LANGUAGE sql STABLE
  RETURN date_trunc('month', now() AT TIME ZONE 'America/Mexico_City')::date;
--> statement-breakpoint

-- Id of the single committee cashbox (null until it is created).
CREATE FUNCTION f_committee_cashbox_id() RETURNS bigint
  LANGUAGE sql STABLE
  RETURN (SELECT id FROM cashbox WHERE type = 'committee');
--> statement-breakpoint

-- Person in custody of a cashbox on a date: the support custodian, the current block leader
-- of a block cashbox or the current treasurer for the committee cashbox (D-07, D-08). On a
-- handover day the newest assignment wins.
CREATE FUNCTION f_cashbox_custodian(p_cashbox_id bigint, p_on date) RETURNS bigint
  LANGUAGE sql STABLE
BEGIN ATOMIC
  SELECT CASE cb.type
    WHEN 'support' THEN cb.custodian_person_id
    ELSE (
      SELECT ra.person_id
      FROM role_assignment ra
      JOIN approval a ON a.id = ra.approval_id AND a.result = 'approved'
      WHERE ((cb.type = 'block' AND ra.role = 'block_leader' AND ra.block_id = cb.block_id)
          OR (cb.type = 'committee' AND ra.role = 'treasurer'))
        AND ra.start_date <= p_on
        AND (ra.end_date IS NULL OR ra.end_date >= p_on)
      ORDER BY ra.start_date DESC
      LIMIT 1)
  END
  FROM cashbox cb
  WHERE cb.id = p_cashbox_id;
END;
--> statement-breakpoint

-- Block code S1-M03 and its current leader.
CREATE VIEW v_block AS
SELECT
  b.id,
  b.section_id,
  s.code || '-' || b.code AS code,
  b.name,
  b.active,
  leader.person_id AS leader_person_id,
  leader.name AS leader_name,
  leader.contact_phone AS leader_contact_phone
FROM block b
JOIN section s ON s.id = b.section_id
LEFT JOIN LATERAL (
  SELECT
    ra.person_id,
    ra.contact_phone,
    concat_ws(' ', p.given_names, p.paternal_surname, p.maternal_surname) AS name
  FROM role_assignment ra
  JOIN approval a ON a.id = ra.approval_id AND a.result = 'approved'
  JOIN person p ON p.id = ra.person_id
  WHERE ra.block_id = b.id AND ra.role = 'block_leader' AND ra.end_date IS NULL
) leader ON true;
--> statement-breakpoint

-- Current block, status and number of families (units not deactivated) of a connection.
CREATE VIEW v_connection AS
SELECT
  c.id,
  c.folio,
  c.address,
  c.activated_on,
  c.deactivated_on,
  cb.block_id,
  CASE
    WHEN c.deactivated_on IS NOT NULL THEN 'deactivated'
    WHEN EXISTS (
      SELECT 1 FROM suspension s
      WHERE s.connection_id = c.id
        AND s.period_from <= f_current_period()
        AND (s.period_to IS NULL OR s.period_to >= f_current_period())
    ) THEN 'suspended'
    ELSE 'active'
  END AS status,
  (SELECT count(*)::int FROM unit u WHERE u.connection_id = c.id AND u.deactivated_on IS NULL)
    AS unit_count
FROM connection c
LEFT JOIN connection_block cb ON cb.connection_id = c.id AND cb.valid_to IS NULL;
--> statement-breakpoint

-- Total of a payment (months at rate x 2 with surcharge, plus extra charges at the fee amount
-- in force on charged_on), and its context on the payment date: block, holder, receiver,
-- whether it was a support payment and whether an approved cancellation exists.
CREATE VIEW v_payment_amount AS
SELECT
  p.id,
  p.folio,
  p.unit_id,
  p.cashbox_id,
  p.occurred_at,
  d.on_date AS occurred_on,
  coalesce(months.amount, 0)::bigint AS months_amount,
  coalesce(charges.amount, 0)::bigint AS charges_amount,
  (coalesce(months.amount, 0) + coalesce(charges.amount, 0))::bigint AS total,
  coalesce(cb.block_id, request.block_id) AS block_id,
  uh.person_id AS holder_person_id,
  f_cashbox_custodian(p.cashbox_id, d.on_date) AS receiver_person_id,
  box.type = 'support' AS is_support,
  cancellation.resolved_at IS NOT NULL AS cancelled,
  cancellation.resolved_at AS cancelled_at
FROM payment p
JOIN cashbox box ON box.id = p.cashbox_id
CROSS JOIN LATERAL (SELECT f_business_date(p.occurred_at) AS on_date) d
LEFT JOIN LATERAL (
  SELECT sum(r.amount * CASE WHEN pm.with_surcharge THEN 2 ELSE 1 END) AS amount
  FROM payment_month pm
  JOIN rate r ON r.id = pm.rate_id
  WHERE pm.payment_id = p.id
) months ON true
LEFT JOIN LATERAL (
  SELECT sum(fa.amount) AS amount
  FROM payment_charge pc
  JOIN extra_charge ec ON ec.id = pc.extra_charge_id
  CROSS JOIN LATERAL (
    SELECT f.amount FROM fee_amount f
    WHERE f.fee_id = ec.fee_id AND f.effective_from <= ec.charged_on
    ORDER BY f.effective_from DESC
    LIMIT 1
  ) fa
  WHERE pc.payment_id = p.id
) charges ON true
LEFT JOIN unit u ON u.id = p.unit_id
LEFT JOIN connection_block cb
  ON cb.connection_id = u.connection_id
  AND cb.valid_from <= d.on_date
  AND (cb.valid_to IS NULL OR cb.valid_to > d.on_date)
LEFT JOIN LATERAL (
  -- A payment without unit only covers an opening fee: its block is the request's block.
  SELECT cr.block_id
  FROM payment_charge pc
  JOIN extra_charge ec ON ec.id = pc.extra_charge_id
  JOIN connection_request cr ON cr.id = ec.connection_request_id
  WHERE pc.payment_id = p.id
  LIMIT 1
) request ON p.unit_id IS NULL
LEFT JOIN unit_holder uh
  ON uh.unit_id = p.unit_id
  AND uh.valid_from <= d.on_date
  AND (uh.valid_to IS NULL OR uh.valid_to > d.on_date)
LEFT JOIN LATERAL (
  SELECT a.resolved_at
  FROM payment_cancellation pca
  JOIN approval a ON a.id = pca.approval_id AND a.result = 'approved'
  WHERE pca.payment_id = p.id
  LIMIT 1
) cancellation ON true;
--> statement-breakpoint

-- Status of a connection request. Its opening fee counts as paid only if the payment that
-- settled it was not cancelled.
CREATE VIEW v_connection_request AS
SELECT
  r.id,
  r.folio,
  r.applicant_id,
  r.address,
  r.block_id,
  r.requested_on,
  r.agreement_id,
  r.cancelled_on,
  conn.id AS connection_id,
  opening.id AS opening_charge_id,
  CASE
    WHEN conn.id IS NOT NULL THEN 'installed'
    WHEN r.cancelled_on IS NOT NULL THEN 'cancelled'
    WHEN ag.result = 'rejected' THEN 'rejected'
    WHEN ag.id IS NULL THEN 'requested'
    WHEN opening.paid THEN 'pending_installation'
    ELSE 'approved_pending_payment'
  END AS status
FROM connection_request r
LEFT JOIN agreement ag ON ag.id = r.agreement_id
LEFT JOIN connection conn ON conn.connection_request_id = r.id
LEFT JOIN LATERAL (
  SELECT
    ec.id,
    EXISTS (
      SELECT 1 FROM payment_charge pc
      JOIN v_payment_amount pa ON pa.id = pc.payment_id
      WHERE pc.extra_charge_id = ec.id AND NOT pa.cancelled
    ) AS paid
  FROM extra_charge ec
  WHERE ec.connection_request_id = r.id AND ec.cancelled_on IS NULL
) opening ON true;
--> statement-breakpoint

-- Current holder and status of a unit (suspended by its own suspension or its connection's).
CREATE VIEW v_unit AS
SELECT
  u.id,
  u.folio,
  u.connection_id,
  u.reference,
  u.registered_on,
  u.activated_on,
  u.billing_start_period,
  u.deactivated_on,
  uh.person_id AS holder_person_id,
  CASE
    WHEN u.deactivated_on IS NOT NULL THEN 'deactivated'
    WHEN u.activated_on IS NULL THEN 'pending_activation'
    WHEN EXISTS (
      SELECT 1 FROM suspension s
      WHERE (s.unit_id = u.id OR s.connection_id = u.connection_id)
        AND s.period_from <= f_current_period()
        AND (s.period_to IS NULL OR s.period_to >= f_current_period())
    ) THEN 'suspended'
    ELSE 'active'
  END AS status
FROM unit u
LEFT JOIN unit_holder uh ON uh.unit_id = u.id AND uh.valid_to IS NULL;
--> statement-breakpoint

-- Status and effective amount of an expense. A plumber payment takes its amount and
-- agreement from the salary it pays (D-24).
CREATE VIEW v_expense AS
SELECT
  e.id,
  e.folio,
  e.category_id,
  e.description,
  e.paid_on,
  e.rejected_on,
  coalesce(e.amount, ps.amount) AS effective_amount,
  coalesce(e.agreement_id, ps.agreement_id) AS effective_agreement_id,
  pp.plumber_id,
  CASE
    WHEN e.rejected_on IS NOT NULL THEN 'rejected'
    WHEN refund.id IS NOT NULL THEN 'refunded'
    WHEN e.paid_on IS NOT NULL THEN 'paid'
    ELSE 'pending_payment'
  END AS status
FROM expense e
LEFT JOIN plumber_payment pp ON pp.expense_id = e.id
LEFT JOIN plumber_salary ps ON ps.id = pp.plumber_salary_id
LEFT JOIN (
  expense_refund refund
  JOIN approval ra ON ra.id = refund.approval_id AND ra.result = 'approved'
) ON refund.expense_id = e.id;
--> statement-breakpoint

-- Every cash movement with its sign and business date. A cancellation is dated on its
-- resolution (it goes to the open period, D-14); a handover moves cash on confirmation, out
-- of the source box and into the committee box, for the amount received (D-16).
CREATE VIEW v_cashbox_movement AS
SELECT ob.cashbox_id, ob.date AS occurred_on, 'opening_balance' AS kind, ob.amount,
  'opening_balance' AS table_name, ob.cashbox_id AS record_id
FROM opening_balance ob
JOIN approval a ON a.id = ob.approval_id AND a.result = 'approved'
UNION ALL
SELECT pa.cashbox_id, pa.occurred_on, 'payment', pa.total, 'payment', pa.id
FROM v_payment_amount pa
UNION ALL
SELECT pa.cashbox_id, f_business_date(a.resolved_at), 'payment_cancellation', -pa.total,
  'payment_cancellation', pca.id
FROM payment_cancellation pca
JOIN approval a ON a.id = pca.approval_id AND a.result = 'approved'
JOIN v_payment_amount pa ON pa.id = pca.payment_id
UNION ALL
SELECT h.source_cashbox_id, f_business_date(h.confirmed_at), 'handover_out', -h.received_amount,
  'handover', h.id
FROM handover h
WHERE h.confirmed_at IS NOT NULL
UNION ALL
SELECT f_committee_cashbox_id(), f_business_date(h.confirmed_at), 'handover_in',
  h.received_amount, 'handover', h.id
FROM handover h
WHERE h.confirmed_at IS NOT NULL
UNION ALL
SELECT f_committee_cashbox_id(), i.date, 'income', i.amount, 'income', i.id
FROM income i
UNION ALL
SELECT f_committee_cashbox_id(), e.paid_on, 'expense', -e.effective_amount, 'expense', e.id
FROM v_expense e
WHERE e.paid_on IS NOT NULL
UNION ALL
SELECT f_committee_cashbox_id(), er.date, 'expense_refund', e.effective_amount,
  'expense_refund', er.id
FROM expense_refund er
JOIN approval a ON a.id = er.approval_id AND a.result = 'approved'
JOIN v_expense e ON e.id = er.expense_id
UNION ALL
SELECT adj.cashbox_id, adj.date, 'adjustment', adj.amount, 'adjustment', adj.id
FROM adjustment adj
JOIN approval a ON a.id = adj.approval_id AND a.result = 'approved';
--> statement-breakpoint

-- Expected balance of every cashbox (0 without movements).
CREATE VIEW v_cashbox_balance AS
SELECT cb.id AS cashbox_id, coalesce(sum(m.amount), 0)::bigint AS balance
FROM cashbox cb
LEFT JOIN v_cashbox_movement m ON m.cashbox_id = cb.id
GROUP BY cb.id;
--> statement-breakpoint

-- Status and difference (declared - received; positive = shortfall) of a handover.
CREATE VIEW v_handover AS
SELECT
  h.id,
  h.folio,
  h.source_cashbox_id,
  h.date,
  h.declared_amount,
  h.received_amount,
  h.withdrawn_at,
  h.confirmed_at,
  h.declared_amount - h.received_amount AS difference,
  adj.amount AS adjusted_amount,
  CASE
    WHEN h.withdrawn_at IS NOT NULL THEN 'withdrawn'
    WHEN h.confirmed_at IS NULL THEN 'pending'
    WHEN h.received_amount = h.declared_amount THEN 'confirmed'
    WHEN adj.amount IS NOT NULL THEN 'adjusted'
    ELSE 'with_difference'
  END AS status
FROM handover h
LEFT JOIN LATERAL (
  SELECT sum(x.amount)::bigint AS amount
  FROM adjustment x
  JOIN approval a ON a.id = x.approval_id AND a.result = 'approved'
  WHERE x.handover_id = h.id
) adj ON true;
--> statement-breakpoint

-- Figures of a closing: starting balance (movements before date_from), totals by kind within
-- the range, expected balance, difference with the counted cash and status.
CREATE VIEW v_closing AS
SELECT
  c.id,
  c.folio,
  c.cashbox_id,
  c.type,
  c.date_from,
  c.date_to,
  c.counted_cash,
  c.reviewed_at,
  c.closed_at,
  before.amount AS starting_balance,
  within.opening_balances AS total_opening_balances,
  within.payments AS total_payments,
  within.cancellations AS total_cancellations,
  within.handovers_out AS total_handovers_out,
  within.handovers_in AS total_handovers_in,
  within.incomes AS total_incomes,
  within.expenses AS total_expenses,
  within.refunds AS total_refunds,
  within.adjustments AS total_adjustments,
  before.amount + within.net AS expected_balance,
  c.counted_cash - (before.amount + within.net) AS difference,
  CASE
    WHEN c.closed_at IS NOT NULL THEN 'closed'
    WHEN c.reviewed_at IS NOT NULL THEN 'reviewed'
    WHEN c.counted_cash IS NOT NULL THEN 'counted'
    ELSE 'draft'
  END AS status
FROM closing c
CROSS JOIN LATERAL (
  SELECT coalesce(sum(m.amount), 0)::bigint AS amount
  FROM v_cashbox_movement m
  WHERE m.cashbox_id = c.cashbox_id AND m.occurred_on < c.date_from
) before
CROSS JOIN LATERAL (
  SELECT
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'opening_balance'), 0)::bigint AS opening_balances,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'payment'), 0)::bigint AS payments,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'payment_cancellation'), 0)::bigint AS cancellations,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'handover_out'), 0)::bigint AS handovers_out,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'handover_in'), 0)::bigint AS handovers_in,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'income'), 0)::bigint AS incomes,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'expense'), 0)::bigint AS expenses,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'expense_refund'), 0)::bigint AS refunds,
    coalesce(sum(m.amount) FILTER (WHERE m.kind = 'adjustment'), 0)::bigint AS adjustments,
    coalesce(sum(m.amount), 0)::bigint AS net
  FROM v_cashbox_movement m
  WHERE m.cashbox_id = c.cashbox_id AND m.occurred_on BETWEEN c.date_from AND c.date_to
) within;
--> statement-breakpoint

-- The president's inbox: pending approvals and the record that uses each one. The API builds
-- the Spanish description from table_name and record_id.
CREATE VIEW v_pending_approval AS
SELECT
  a.id,
  a.type,
  a.reason,
  a.requested_by,
  a.requested_at,
  ref.table_name,
  ref.record_id
FROM approval a
LEFT JOIN LATERAL (
  SELECT 'role_assignment' AS table_name, x.id AS record_id FROM role_assignment x WHERE x.approval_id = a.id
  UNION ALL SELECT 'rate', x.id FROM rate x WHERE x.approval_id = a.id
  UNION ALL SELECT 'plumber_salary', x.id FROM plumber_salary x WHERE x.approval_id = a.id
  UNION ALL SELECT 'opening_balance', x.cashbox_id FROM opening_balance x WHERE x.approval_id = a.id
  UNION ALL SELECT 'unit_change_request', x.id FROM unit_change_request x WHERE x.approval_id = a.id
  UNION ALL SELECT 'payment_cancellation', x.id FROM payment_cancellation x WHERE x.approval_id = a.id
  UNION ALL SELECT 'adjustment', x.id FROM adjustment x WHERE x.approval_id = a.id
  UNION ALL SELECT 'expense_refund', x.id FROM expense_refund x WHERE x.approval_id = a.id
  LIMIT 1
) ref ON true
WHERE a.result IS NULL;
