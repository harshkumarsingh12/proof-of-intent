-- Spending authority is reserved when an order is created (#155).
-- reserved_until is the cart's expiry: a pending order stops counting against the intent's budget and recurrence
-- limits when it passes, or earlier when it is voided or fails. Captured and UNKNOWN_OUTCOME orders always count.
alter table orders add column reserved_until timestamptz;
create index orders_active_idx on orders (intent_mandate_id, status);
