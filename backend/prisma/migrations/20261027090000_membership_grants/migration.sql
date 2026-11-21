-- M11：会员权益授予记录（独立于 User.role 的限期权益；orderId 幂等）
CREATE TABLE "membership_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "order_id" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_grants_order_id_key" ON "membership_grants"("order_id");
CREATE INDEX "membership_grants_user_id_ends_at_idx" ON "membership_grants"("user_id", "ends_at");

ALTER TABLE "membership_grants" ADD CONSTRAINT "membership_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
