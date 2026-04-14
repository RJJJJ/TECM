'use client';

import { useEffect, useState } from 'react';
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

function clientValidate(formData: FormData) {
  const bookingDate = String(formData.get('booking_date') ?? '').trim();
  const startTime = String(formData.get('start_time') ?? '').trim();
  const endTime = String(formData.get('end_time') ?? '').trim();

  if (!bookingDate || !startTime || !endTime) {
    return '請完整填寫 booking date / start time / end time。';
  }

  if (startTime > endTime) {
    return 'Start time 不可晚於 end time。';
  }

  return null;
}

export default function BookingUpdateForm({ booking }: Props) {
  const formAction = updateBookingAction.bind(null, booking.id);
  const [state, action] = useFormState(formAction, initialState);
  const [clientMessage, setClientMessage] = useState<string | null>(null);
  const [showSavedHint, setShowSavedHint] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      setShowSavedHint(true);
      const timer = window.setTimeout(() => setShowSavedHint(false), 2600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [state.status]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">更新 Booking</h3>
          <p className="mt-1 text-xs text-slate-500">僅更新既有欄位（Status / Date / Time / Note）</p>
        </div>
      </div>

      <form
        action={action}
        className="space-y-4"
        onSubmit={(event) => {
          const validationMessage = clientValidate(new FormData(event.currentTarget));
          if (validationMessage) {
            event.preventDefault();
            setClientMessage(validationMessage);
            return;
          }

          setClientMessage(null);
        }}
      >
        <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
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

          <div className="md:col-span-2">
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
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          {clientMessage && <p className="text-sm font-medium text-rose-700">{clientMessage}</p>}
          {state.status === 'success' && <p className="text-sm font-medium text-emerald-700">{state.message}</p>}
          {state.status === 'error' && <p className="text-sm font-medium text-rose-700">{state.message}</p>}
          {showSavedHint && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              已儲存最新資料
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
