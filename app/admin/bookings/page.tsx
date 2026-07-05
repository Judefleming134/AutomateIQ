import { Calendar, Clock, Mail, Phone, Building2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatSlot } from "@/lib/booking/slots";
import {
  approveBooking,
  cancelBooking,
  completeBooking,
  rescheduleBooking,
} from "./actions";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "bk-badge-pending" },
  confirmed: { label: "Confirmed", cls: "bk-badge-confirmed" },
  rescheduled: { label: "Rescheduled", cls: "bk-badge-rescheduled" },
  completed: { label: "Completed", cls: "bk-badge-completed" },
  cancelled: { label: "Cancelled", cls: "bk-badge-cancelled" },
};

export default async function AdminBookingsPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: bookings } = await supabase
    .from("strategy_bookings")
    .select("id, name, company, email, phone, business_type, message, slot_at, status, created_at")
    .order("slot_at", { ascending: true });

  const all = bookings ?? [];
  const nowIso = new Date().toISOString();
  const active = ["pending", "confirmed", "rescheduled"];
  const upcoming = all.filter((b) => active.includes(b.status) && b.slot_at >= nowIso);
  const past = all.filter((b) => !active.includes(b.status) || b.slot_at < nowIso);

  const pendingCount = all.filter((b) => b.status === "pending").length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Strategy Session bookings</h1>
          <p>
            Free AI Strategy Sessions booked from the public site. Approve to send a confirmation,
            reschedule, or cancel to free the slot.
          </p>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        <div className="stat-chip">
          <span className="stat-chip-value">{upcoming.length}</span>
          <span className="stat-chip-label">Upcoming</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{pendingCount}</span>
          <span className="stat-chip-label">Awaiting approval</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{all.length}</span>
          <span className="stat-chip-label">Total</span>
        </div>
      </div>

      <h2 className="bk-group-title">Upcoming</h2>
      {upcoming.length === 0 ? (
        <div className="panel panel-block"><p className="empty-state">No upcoming bookings.</p></div>
      ) : (
        <div className="bk-list">
          {upcoming.map((b) => <BookingCard key={b.id} b={b} />)}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h2 className="bk-group-title" style={{ marginTop: 32 }}>Past &amp; closed</h2>
          <div className="bk-list">
            {past.map((b) => <BookingCard key={b.id} b={b} past />)}
          </div>
        </>
      )}
    </>
  );
}

type Booking = {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string | null;
  business_type: string | null;
  message: string | null;
  slot_at: string;
  status: string;
};

function BookingCard({ b, past = false }: { b: Booking; past?: boolean }) {
  const status = STATUS_META[b.status] ?? STATUS_META.pending;

  async function approve() {
    "use server";
    return approveBooking(b.id);
  }
  async function cancel() {
    "use server";
    return cancelBooking(b.id);
  }
  async function complete() {
    "use server";
    return completeBooking(b.id);
  }

  return (
    <div className={`bk-card panel ${past ? "is-past" : ""}`}>
      <div className="bk-card-main">
        <div className="bk-card-when">
          <Calendar size={15} />
          <span>{formatSlot(b.slot_at)}</span>
          <span className={`bk-badge ${status.cls}`}>{status.label}</span>
        </div>
        <div className="bk-card-who">
          <strong>{b.name}</strong>
          {b.company && <span className="bk-company"><Building2 size={13} /> {b.company}</span>}
          {b.business_type && <span className="bk-type">{b.business_type}</span>}
        </div>
        <div className="bk-card-contact">
          <a href={`mailto:${b.email}`}><Mail size={13} /> {b.email}</a>
          {b.phone && <span><Phone size={13} /> {b.phone}</span>}
        </div>
        {b.message && <p className="bk-card-msg">“{b.message}”</p>}
      </div>

      {!past && (
        <div className="bk-card-actions">
          {(b.status === "pending" || b.status === "rescheduled") && (
            <ActionForm action={approve} className="inline-form">
              <SubmitButton className="btn btn-primary btn-sm" pendingText="…">Approve &amp; confirm</SubmitButton>
            </ActionForm>
          )}
          {b.status === "confirmed" && (
            <ActionForm action={complete} className="inline-form">
              <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">Mark completed</SubmitButton>
            </ActionForm>
          )}

          <details className="disclosure bk-reschedule">
            <summary><Clock size={13} /> Reschedule</summary>
            <ActionForm action={rescheduleBooking} className="panel form-card" style={{ maxWidth: "none", marginTop: 8 }}>
              <input type="hidden" name="id" value={b.id} />
              <div className="field">
                <label htmlFor={`slot-${b.id}`}>New date &amp; time (Irish time)</label>
                <input id={`slot-${b.id}`} name="slot" type="datetime-local" required className="content-schedule-input" style={{ fontSize: 13.5 }} />
              </div>
              <div className="form-actions">
                <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">Reschedule &amp; notify</SubmitButton>
              </div>
            </ActionForm>
          </details>

          <ActionForm action={cancel} className="inline-form">
            <SubmitButton className="btn btn-danger btn-sm" pendingText="…">Cancel</SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}
