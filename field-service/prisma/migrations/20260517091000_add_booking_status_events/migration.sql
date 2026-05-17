-- Add BookingStatusEvent for booking lifecycle audit trail
CREATE TABLE "booking_status_events" (
    "id"         TEXT NOT NULL,
    "bookingId"  TEXT NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus"   "BookingStatus" NOT NULL,
    "actorId"    TEXT NOT NULL,
    "actorRole"  TEXT NOT NULL,
    "notes"      TEXT,
    "timestamp"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_status_events_bookingId_idx" ON "booking_status_events"("bookingId");

ALTER TABLE "booking_status_events"
    ADD CONSTRAINT "booking_status_events_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
