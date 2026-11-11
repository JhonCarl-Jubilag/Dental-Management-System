import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { HeroSlideshow } from './landing';

jest.mock('react-router-dom', () => ({ Link: 'a' }), { virtual: true });
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
