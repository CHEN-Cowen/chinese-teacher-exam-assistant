-- M12：支付订单 / 支付尝试 / 渠道交易 / 回调事件 / 退款 / 对账差异；
-- 会员授予增加 revoked_at（全额退款成功后回收该订单对应授予）。

ALTER TABLE "membership_grants" ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE TABLE "payment_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "price_version" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "grant_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_orders_user_id_status_idx" ON "payment_orders"("user_id", "status");

ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channel_out_trade_no" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "prepay_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_attempts_order_id_idx" ON "payment_attempts"("order_id");

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "channel_transactions" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channel_transaction_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "channel_transactions_channel_transaction_id_key" ON "channel_transactions"("channel_transaction_id");
CREATE INDEX "channel_transactions_order_id_idx" ON "channel_transactions"("order_id");
CREATE INDEX "channel_transactions_paid_at_idx" ON "channel_transactions"("paid_at");

ALTER TABLE "channel_transactions" ADD CONSTRAINT "channel_transactions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_callback_events" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "order_id" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "reject_reason" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_callback_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_callback_events_event_id_key" ON "payment_callback_events"("event_id");
CREATE INDEX "payment_callback_events_order_id_idx" ON "payment_callback_events"("order_id");

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "channel_refund_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT,
    "requested_by" TEXT NOT NULL,
    "entitlement_action" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "order_id" TEXT,
    "channel_transaction_id" TEXT,
    "local_amount_cents" INTEGER,
    "channel_amount_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reconciliation_records_dedupe_key_key" ON "reconciliation_records"("dedupe_key");
CREATE INDEX "reconciliation_records_date_status_idx" ON "reconciliation_records"("date", "status");
