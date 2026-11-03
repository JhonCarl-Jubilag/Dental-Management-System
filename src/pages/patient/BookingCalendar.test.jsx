import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import BookingCalendar from './BookingCalendar';
import { supabase } from '../../services/supabase';
import { getClinicDate, formatClinicDate } from '../../utils/clinicScheduling';

jest.mock('../../services/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

beforeEach(() => jest.resetAllMocks());

function Form() {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  return <BookingCalendar doctorId={3} serviceId="5" leadMinutes={60} date={date} time={time}
    setDate={setDate} setTime={setTime} revision={0} />;
}

test('only enables returned days and clears a selection when a booking takes the last slot', async () => {
  const today = getClinicDate();
  supabase.rpc.mockResolvedValue({ data: [{ booking_date: today, times: ['14:30'] }] });
  render(<Form />);
  const day = screen.getByRole('button', { name: formatClinicDate(today) });
  await waitFor(() => expect(day).toBeEnabled());
  expect(supabase.rpc).toHaveBeenCalledWith('get_booking_month_slots', {
    p_doctor_id: 3, p_service_id: 5, p_month: today.slice(0, 7) + '-01',
  });
  const other = today.slice(0, 8) + (today.endsWith('01') ? '02' : '01');
  expect(screen.getByRole('button', { name: formatClinicDate(other) })).toBeDisabled();
  fireEvent.click(day);
  const slot = await screen.findByRole('button', { name: '02:30 PM' });
  fireEvent.click(slot);
  expect(slot).toHaveAttribute('aria-pressed', 'true');
  supabase.rpc.mockResolvedValue({ data: [] });
  fireEvent.focus(window);
  await waitFor(() => expect(day).toBeDisabled());
  expect(day).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('button', { name: '02:30 PM' })).toBeNull();
});

test('offers a retry on failure and loads the newly browsed month', async () => {
  supabase.rpc.mockResolvedValueOnce({ error: { message: 'offline' } }).mockResolvedValue({ data: [] });
  render(<Form />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry availability' }));
  await screen.findByText(/No available appointments this month/);
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByText(/No available appointments this month/);
  expect(supabase.rpc.mock.calls.at(-1)[1].p_month).not.toEqual(getClinicDate().slice(0, 7) + '-01');
});

test('loads bookable dates and times when the monthly database function is missing', async () => {
  const today = getClinicDate();
  const query = {};
  ['select', 'eq', 'gte', 'lt'].forEach(method => { query[method] = jest.fn(() => query); });
  query.order = jest.fn().mockResolvedValue({ data: [
    { available_date: today }, { available_date: today },
  ] });
  supabase.from.mockReturnValue(query);
  supabase.rpc.mockImplementation(async name => name === 'get_booking_month_slots'
    ? { error: { code: 'PGRST202' } }
    : { data: [{ time_slot: '14:30' }] });
  render(<Form />);
  const day = screen.getByRole('button', { name: formatClinicDate(today) });
  await waitFor(() => expect(day).toBeEnabled());
  expect(supabase.from).toHaveBeenCalledWith('doctor_availability');
  expect(query.gte).toHaveBeenCalledWith('available_date', today);
  expect(supabase.rpc.mock.calls.filter(([name]) => name === 'get_booking_time_slots')).toHaveLength(1);
  expect(supabase.rpc).toHaveBeenCalledWith('get_booking_time_slots', {
    p_doctor_id: 3, p_service_id: 5, p_date: today, p_interval: 30, p_lead_minutes: 60,
    p_exclude_appointment_id: null, p_time: null,
  });
  fireEvent.click(day);
  expect(await screen.findByRole('button', { name: '02:30 PM' })).toBeEnabled();
  supabase.rpc.mockImplementation(async name => name === 'get_booking_month_slots'
    ? { error: { code: 'PGRST202' } } : { data: [] });
  fireEvent.focus(window);
  await waitFor(() => expect(day).toBeDisabled());
  expect(day).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('button', { name: '02:30 PM' })).toBeNull();
});

test('keeps dates disabled if checking daily availability fails', async () => {
  const today = getClinicDate();
  const query = {};
  ['select', 'eq', 'gte', 'lt'].forEach(method => { query[method] = jest.fn(() => query); });
  query.order = jest.fn().mockResolvedValue({ data: [{ available_date: today }] });
  supabase.from.mockReturnValue(query);
  supabase.rpc.mockImplementation(async name => name === 'get_booking_month_slots'
    ? { error: { code: 'PGRST202' } } : { error: { message: 'offline' } });
  render(<Form />);
  await screen.findByRole('button', { name: 'Retry availability' });
  expect(screen.getByRole('button', { name: formatClinicDate(today) })).toBeDisabled();
});
