-- FifthCusp client catalogue. Run in Supabase SQL Editor after a fresh backup.
-- Prices/durations for NEW services are editable SAMPLE setup values, not an
-- approved clinic quotation. Random assignments do not verify clinical skills.
-- Review the returned catalogue and dentist assignments before patient use.
-- Keep all historical service rows, appointment/billing links and inventory
-- requirements. Equivalent services retain their IDs, prices and durations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtext('fifthcusp-client-service-catalogue-20261030'));
LOCK TABLE public.services, public.doctors, public.doctor_services IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE client_service_catalogue (
  display_order integer PRIMARY KEY,
  service_name text NOT NULL UNIQUE,
  legacy_name text UNIQUE,
  description text NOT NULL,
  sample_price numeric NOT NULL CHECK (sample_price >= 0),
  sample_duration integer NOT NULL CHECK (sample_duration > 0)
) ON COMMIT DROP;

INSERT INTO client_service_catalogue VALUES
  (1, 'Light-Cured Restoration', 'Tooth Filling',
   'A tooth-colored filling hardened with a special dental light to repair a cavity or a small damaged area of a tooth.', 1200, 60),
  (2, 'Inlay', NULL,
   'A custom-made restoration fitted inside the chewing surface of a tooth to repair damage that needs more support than a regular filling.', 10000, 90),
  (3, 'Onlay', NULL,
   'A custom-made restoration that covers a damaged part of a tooth, including one or more chewing points, while keeping the remaining healthy tooth.', 12000, 90),
  (4, 'Root Canal Therapy', 'Root Canal',
   'Treatment that removes infected or damaged tissue inside a tooth, then cleans and seals the root canals to help save the tooth.', 5000, 120),
  (5, 'Prosthodontics', NULL,
   'Assessment and treatment to restore damaged or missing teeth using options such as crowns, bridges, or dentures, based on your dental needs.', 1500, 60),
  (6, 'Fixed Bridges', 'Dental Bridge',
   'Replacement teeth attached to supporting teeth or implants to fill a gap from missing teeth. The bridge stays in place and is not removed for daily cleaning.', 12000, 120),
  (7, 'Removable Dentures', 'Dentures',
   'Custom-made replacement teeth that you can take out for cleaning. Partial or complete dentures help replace some or all missing teeth.', 15000, 90),
  (8, 'Precision Attachments', NULL,
   'Special connectors used with certain removable dentures to help hold them securely to supporting teeth or restorations.', 20000, 90),
  (9, 'Emax Veneers', NULL,
   'Thin, custom-made ceramic shells bonded to the front of suitable teeth to improve their color, shape, or the appearance of small gaps and chips.', 18000, 120),
  (10, 'Orthodontics', NULL,
   'Assessment and treatment of uneven teeth or bite problems using braces or other suitable appliances. Your dentist will explain the treatment plan and follow-up visits.', 40000, 60),
  (11, 'TMJ Splint Treatment', NULL,
   'Assessment and fitting of a custom oral splint when appropriate for jaw-joint or muscle concerns. The dentist checks the fit and monitors your response.', 10000, 60),
  (12, 'Oral Prophylaxis', 'Teeth Cleaning',
   'Professional cleaning to remove plaque, hardened deposits, and surface stains from teeth, followed by polishing to support healthy teeth and gums.', 800, 60),
  (13, 'Bone Grafting Procedures', NULL,
   'Placement of bone graft material in an area of the jaw that needs additional bone support, such as before certain implant treatments or after bone loss.', 15000, 120),
  (14, 'Mucosal Flap', NULL,
   'An oral surgical procedure that carefully lifts a section of soft tissue to reach the area needing treatment, then repositions and closes the tissue.', 8000, 90),
  (15, 'Deep Scaling', NULL,
   'A deeper cleaning below the gumline to remove plaque and hardened deposits around tooth roots when gum disease requires more than routine cleaning.', 2500, 90),
  (16, 'Pedodontics Treatment', 'Child Dental Care',
   'Dental care for children, including assessment, preventive care, and treatment suited to their age, teeth, and oral-health needs.', 600, 60),
  (17, 'Myofunctional Therapy', NULL,
   'Guided exercises and habit training to improve tongue, lip, and facial muscle function, including resting posture and swallowing patterns, after assessment.', 1500, 45),
  (18, 'System Tooth Whitening', NULL,
   'Professional whitening using a dentist-selected system to lighten the color of natural teeth. The dentist will assess suitability and explain the method.', 6000, 60),
  (19, 'US Tooth Whitening using ZOOM 2', NULL,
   'An in-clinic whitening treatment using the ZOOM 2 system, with whitening gel and a special light to lighten natural teeth after a dental assessment.', 18000, 90);

DO $catalogue$
DECLARE
  item record;
  selected_service bigint;
  selected_doctor bigint;
  selected_assignment bigint;
  matches integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE status = 'active') THEN
    RAISE EXCEPTION 'No active dentist is available. Review dentist records before updating the catalogue.';
  END IF;

  -- The existing filling animation is keyed to ID 4. Do not silently reuse
  -- that ID for another procedure or create a replacement filling record.
  IF NOT EXISTS (SELECT 1 FROM public.services WHERE service_id = 4
    AND lower(btrim(service_name)) IN ('tooth filling', 'light-cured restoration')) THEN
    RAISE EXCEPTION 'The reviewed Tooth Filling service (ID 4) differs in this database. Review its animation mapping before proceeding.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.services s WHERE s.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM client_service_catalogue c
        WHERE lower(btrim(s.service_name)) IN (lower(c.service_name), lower(c.legacy_name)))
      AND lower(btrim(s.service_name)) NOT IN (
        'dental checkup', 'tooth extraction', 'orthodontic consultation',
        'teeth whitening', 'dental crown', 'dental implant', 'gum treatment',
        'dental x-ray', 'emergency dental care')
  ) THEN
    RAISE EXCEPTION 'An unreviewed active service was found. Review it before replacing the public catalogue.';
  END IF;

  FOR item IN SELECT * FROM client_service_catalogue ORDER BY display_order LOOP
    SELECT count(*), min(service_id) INTO matches, selected_service
      FROM public.services
      WHERE lower(btrim(service_name)) IN (lower(item.service_name), lower(item.legacy_name));
    IF matches > 1 THEN
      RAISE EXCEPTION 'Multiple existing services match %. Resolve the mapping without deleting history before proceeding.', item.service_name;
    END IF;

    IF selected_service IS NULL THEN
      INSERT INTO public.services(service_name, description, price, duration_minutes, status)
        VALUES(item.service_name, item.description, item.sample_price, item.sample_duration, 'active')
        RETURNING service_id INTO selected_service;
    ELSE
      UPDATE public.services SET
        service_name = item.service_name,
        description = item.description,
        price = CASE WHEN price IS NULL OR price < 0 THEN item.sample_price ELSE price END,
        duration_minutes = CASE WHEN duration_minutes > 0 THEN duration_minutes ELSE item.sample_duration END,
        -- Activate renamed legacy entries on first application; a rerun must
        -- respect a canonical service intentionally deactivated by the clinic.
        status = CASE WHEN lower(btrim(service_name)) = lower(item.legacy_name)
          THEN 'active'::public.user_status ELSE status END
        WHERE service_id = selected_service;
    END IF;

    -- Retain valid existing assignments. Only fill a missing active-dentist
    -- assignment; a repeat run never reshuffles already assigned services.
    IF NOT EXISTS (SELECT 1 FROM public.doctor_services ds JOIN public.doctors d USING(doctor_id)
      WHERE ds.service_id = selected_service AND ds.status = 'active' AND d.status = 'active') THEN
      SELECT doctor_id INTO selected_doctor FROM public.doctors WHERE status = 'active' ORDER BY random() LIMIT 1;
      SELECT doctor_service_id INTO selected_assignment FROM public.doctor_services
        WHERE doctor_id = selected_doctor AND service_id = selected_service ORDER BY doctor_service_id LIMIT 1;
      IF selected_assignment IS NULL THEN
        INSERT INTO public.doctor_services(doctor_id, service_id, status) VALUES(selected_doctor, selected_service, 'active');
      ELSE
        UPDATE public.doctor_services SET status = 'active' WHERE doctor_service_id = selected_assignment;
      END IF;
    END IF;
  END LOOP;

  -- These are distinct procedures/categories, not aliases for the requested
  -- services. Archive them instead of relabelling their treatment history.
  -- Leave their assignments and requirements in place for existing bookings.
  UPDATE public.services SET status = 'inactive'
    WHERE lower(btrim(service_name)) IN (
      'dental checkup', 'tooth extraction', 'orthodontic consultation',
      'teeth whitening', 'dental crown', 'dental implant', 'gum treatment',
      'dental x-ray', 'emergency dental care');
END;
$catalogue$;

-- Review this result after successful execution. Existing equivalent service
-- prices are retained; the other fees/durations are provisional setup values.
SELECT c.display_order, s.service_id, s.service_name, s.description, s.price,
       s.duration_minutes, s.status,
       string_agg(DISTINCT concat('Dr. ', d.first_name, ' ', d.last_name), ', '
         ORDER BY concat('Dr. ', d.first_name, ' ', d.last_name)) FILTER (WHERE d.doctor_id IS NOT NULL) AS assigned_active_dentists
  FROM client_service_catalogue c
  JOIN public.services s ON lower(btrim(s.service_name)) = lower(c.service_name)
  LEFT JOIN public.doctor_services ds ON ds.service_id = s.service_id AND ds.status = 'active'
  LEFT JOIN public.doctors d ON d.doctor_id = ds.doctor_id AND d.status = 'active'
 GROUP BY c.display_order, s.service_id, s.service_name, s.description, s.price, s.duration_minutes, s.status
 ORDER BY c.display_order;
COMMIT;
