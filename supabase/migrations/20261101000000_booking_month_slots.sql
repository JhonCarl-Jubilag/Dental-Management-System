-- One row per bookable day; reuse the booking RPC's privacy and overlap checks.
CREATE OR REPLACE FUNCTION public.get_booking_month_slots(
  p_doctor_id bigint, p_service_id bigint, p_month date)
RETURNS TABLE(booking_date date, times text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
  WITH days AS (
    SELECT DISTINCT da.available_date
    FROM public.doctor_availability da
    WHERE da.doctor_id = p_doctor_id AND da.is_available
      AND da.available_date >= greatest(date_trunc('month', p_month::timestamp)::date,
                                        (now() AT TIME ZONE 'Asia/Manila')::date)
      AND da.available_date < date_trunc('month', p_month::timestamp) + interval '1 month'
  )
  SELECT days.available_date, array_agg(slot.time_slot ORDER BY slot.time_slot)
  FROM days
  JOIN public.services s ON s.service_id = p_service_id AND s.status = 'active'
  CROSS JOIN LATERAL public.get_booking_time_slots(
    p_doctor_id, p_service_id, days.available_date, 30, s.duration_minutes, NULL, NULL
  ) slot
  GROUP BY days.available_date ORDER BY days.available_date;
$$;
REVOKE ALL ON FUNCTION public.get_booking_month_slots(bigint,bigint,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_booking_month_slots(bigint,bigint,date) TO authenticated;
NOTIFY pgrst, 'reload schema';
