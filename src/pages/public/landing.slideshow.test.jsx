import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import Landing, { HeroSlideshow, getChatReply } from './landing';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../services/supabase';
import { CLINIC_ADDRESS, CLINIC_DIRECTIONS_URL, CLINIC_PHONE, CLINIC_HOURS } from '../../services/clinicDetails';

jest.mock('react-router-dom', () => ({
  Link: ({ to, ...props }) => require('react').createElement('a', { ...props, href: to }),
}), { virtual: true });
jest.mock('../../contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../services/supabase', () => ({ supabase: {} }));
jest.mock('../../components/common/ClinicMap', () => () => null);

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const loadedImages = new WeakSet();

function loadRequestedSlides(container) {
  let image = Array.from(container.querySelectorAll('.welcome-slides img')).find(item => !loadedImages.has(item));
  while (image) {
    loadedImages.add(image);
    fireEvent.load(image);
    image = Array.from(container.querySelectorAll('.welcome-slides img')).find(item => !loadedImages.has(item));
  }
}

function activeImage(container) {
  return container.querySelector('.welcome-slides img.is-active');
}

test('starts with HMO, advances automatically, and wraps after all six images', () => {
  const { container, unmount } = render(<HeroSlideshow />);
  expect(activeImage(container)).toHaveAttribute('alt', 'List of HMO accredited providers');
  expect(container.querySelectorAll('.welcome-slides img')).toHaveLength(1);
  loadRequestedSlides(container);
  expect(container.querySelectorAll('.welcome-slides img')).toHaveLength(3);
  const sequence = [
    'Clinic lounge and waiting area',
    'Clinic entrance',
    'Dental treatment room',
    'Clinic waiting area seating',
    'Dental chair and treatment equipment',
    'List of HMO accredited providers',
  ];
  for (const alt of sequence) {
    act(() => jest.advanceTimersByTime(6000));
    expect(activeImage(container)).toHaveAttribute('alt', alt);
    loadRequestedSlides(container);
  }
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test('manual navigation resets the delay and playback can pause and resume', () => {
  const { container } = render(<HeroSlideshow />);
  loadRequestedSlides(container);
  act(() => jest.advanceTimersByTime(5000));
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
  loadRequestedSlides(container);
  act(() => jest.advanceTimersByTime(1000));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic lounge and waiting area');
  act(() => jest.advanceTimersByTime(5000));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic entrance');
  loadRequestedSlides(container);
  fireEvent.click(screen.getByRole('button', { name: 'Pause slideshow' }));
  act(() => jest.advanceTimersByTime(12000));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic entrance');
  fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic lounge and waiting area');
  fireEvent.click(screen.getByRole('button', { name: 'Resume slideshow' }));
  act(() => jest.advanceTimersByTime(6000));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic entrance');
});

test('waits for the next image to load before advancing', () => {
  const { container } = render(<HeroSlideshow />);
  fireEvent.load(activeImage(container));
  act(() => jest.advanceTimersByTime(12000));
  expect(activeImage(container)).toHaveAttribute('alt', 'List of HMO accredited providers');
  expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled();
  fireEvent.load(container.querySelectorAll('.welcome-slides img')[1]);
  act(() => jest.advanceTimersByTime(6000));
  expect(activeImage(container)).toHaveAttribute('alt', 'Clinic lounge and waiting area');
});


const faqServices = [
  { service_id: 4, service_name: 'Light-Cured Restoration', description: 'Restores a damaged tooth.', price: 1200 },
  { service_id: 7, service_name: 'Root Canal Therapy', description: 'Treats the inside of an affected tooth.', price: 6000 },
  { service_id: 23, service_name: 'Orthodontics', description: 'Helps align your teeth.', price: 30000 },
];

test.each(['How much is root canal treatment?', 'Magkano ang pasta?'])('pricing takes priority over a named service for %s', question => {
  const answer = getChatReply(question, { services: faqServices });
  expect(answer.text).toContain('after your oral examination');
  expect(answer.text).not.toMatch(/1200|6000|₱/);
});

test('appointment changes and booking questions do not return the clinic hours or location', () => {
  expect(getChatReply('Can I change my appointment time?').text).toContain('24 hours');
  expect(getChatReply('Where can I book an appointment?').text).toContain('Log in');
  expect(getChatReply('How can I open my appointment?').text).toContain('My Appointments');
});

test('uses active service descriptions and links while recognizing common names', () => {
  const answer = getChatReply('What is pasta?', { services: faqServices });
  expect(answer.text).toContain('Restores a damaged tooth.');
  expect(answer.links).toContainEqual({ label: 'View service details', href: '/service/4' });
  expect(getChatReply('What services do you offer?').text).toContain('unavailable');
  expect(getChatReply('What is whitening?', { services: faqServices }).text).not.toContain('align your teeth');
});

test('shares the map location and keeps private appointment information behind login', () => {
  const location = getChatReply('Saan ang clinic?');
  expect(location.text).toContain(CLINIC_ADDRESS);
  expect(location.links).toContainEqual({ label: 'Get directions', href: CLINIC_DIRECTIONS_URL });
  expect(getChatReply('How can I contact the clinic?').text).toContain(CLINIC_PHONE);
  expect(getChatReply('What are your clinic hours?').text).toContain(CLINIC_HOURS);
  expect(getChatReply('Check my appointment status').links).toContainEqual({ label: 'Log in', href: '/login' });
  expect(getChatReply('Check my appointment status', { user: { id: 'patient' }, userType: 'patient' }).links)
    .toContainEqual({ label: 'My Appointments', href: '/my-appointments' });
});

test('guest FAQ buttons, typed questions, and footer use the current clinic details', async () => {
  useAuth.mockReturnValue({ user: null, userType: null, userDetails: null, signOut: jest.fn() });
  const query = { select: () => query, eq: () => query, order: async () => ({ data: faqServices, error: null }) };
  supabase.from = jest.fn(() => query);
  let container;
  await act(async () => { ({ container } = render(<Landing />)); });

  const footer = within(container.querySelector('footer'));
  expect(footer.getByRole('link', { name: CLINIC_ADDRESS })).toHaveAttribute('href', CLINIC_DIRECTIONS_URL);
  expect(footer.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  expect(footer.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');

  fireEvent.click(screen.getByRole('button', { name: 'Clinic location', exact: true }));
  const log = within(screen.getByRole('log'));
  expect(log.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', CLINIC_DIRECTIONS_URL);

  const input = screen.getByRole('textbox', { name: 'Message the dental assistant' });
  fireEvent.change(input, { target: { value: 'How much is root canal treatment?' } });
  fireEvent.submit(input.closest('form'));
  expect(log.getByText('The final price for your treatment will be confirmed after your oral examination.')).toBeInTheDocument();
  expect(input).toHaveValue('');
  expect(log.queryByText(/₱|1234-5678|Tanzang Luma/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'All questions', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Clinic hours', exact: true }));
  expect(log.getByText(new RegExp('Monday'))).toHaveTextContent(CLINIC_HOURS);
});

test('signed-in patient footer omits Dashboard and FAQ booking links to patient booking', async () => {
  useAuth.mockReturnValue({ user: { id: 'patient' }, userType: 'patient', userDetails: { first_name: 'Sample' }, signOut: jest.fn() });
  const query = { select: () => query, eq: () => query, order: async () => ({ data: faqServices, error: null }) };
  supabase.from = jest.fn(() => query);
  let container;
  await act(async () => { ({ container } = render(<Landing />)); });
  const footer = within(container.querySelector('footer'));
  expect(footer.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  expect(footer.getByRole('link', { name: 'My Appointments' })).toHaveAttribute('href', '/my-appointments');
  fireEvent.click(screen.getByRole('button', { name: 'Book appointment', exact: true }));
  expect(within(screen.getByRole('log')).getByRole('link', { name: 'Book appointment' })).toHaveAttribute('href', '/book-appointment');
});

