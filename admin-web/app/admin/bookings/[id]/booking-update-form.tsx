'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateBookingAction, type UpdateFormState } from './actions';

type BookingEditable = {
  id: string;
  status: string | null;
  note: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
};

type Props = {
  booking: BookingEditable;
};

const initialState: UpdateFormState = {
  status: 'idle'
};

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
    >
      {pending ? '儲存中...' : '儲存變更'}
    </button>
  );
}

function normalizeTimeValue(value: string | null) {
  if (!value) return '';
  return value.slice(0, 5);
}

export default function BookingUpdateForm({ booking }: Props) {
  const formAction = updateBookingAction.bind(null, booking.id);
  const [state, action] = useFormState(formAction, initialState);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">編輯 Booking</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium text-slate-700">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={booking.status ?? 'pending'}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div>
          <label htmlFor="booking_date" className="mb-1 block text-sm font-medium text-slate-700">
            Booking Date
          </label>
          <input
            id="booking_date"
            name="booking_date"
            type="date"
            required
            defaultValue={booking.booking_date ?? ''}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="start_time" className="mb-1 block text-sm font-medium text-slate-700">
            Start Time
          </label>
          <input
            id="start_time"
            name="start_time"
            type="time"
            required
            defaultValue={normalizeTimeValue(booking.start_time)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>

        <div>
          <label htmlFor="end_time" className="mb-1 block text-sm font-medium text-slate-700">
            End Time
          </label>
          <input
            id="end_time"
            name="end_time"
            type="time"
            required
            defaultValue={normalizeTimeValue(booking.end_time)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
          />
        </div>
      </div>

      <div>
        <label htmlFor="note" className="mb-1 block text-sm font-medium text-slate-700">
          Note
        </label>
        <textarea
          id="note"
          name="note"
          rows={4}
          defaultValue={booking.note ?? ''}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-slate-300 focus:ring"
        />
      </div>

      <div className="flex items-center gap-3">
        <SaveButton />
        {state.status === 'success' && (
          <p className="text-sm font-medium text-emerald-700">{state.message}</p>
        )}
        {state.status === 'error' && (
          <p className="text-sm font-medium text-rose-700">{state.message}</p>
        )}
      </div>
    </form>
  );
}
