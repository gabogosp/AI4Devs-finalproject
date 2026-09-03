CREATE TABLE "order_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "changed_by" text,
  "changed_at" timestamp(3) NOT NULL DEFAULT now()
);
CREATE INDEX "order_status_history_order_id_changed_at_idx"
  ON "order_status_history" ("order_id", "changed_at");
