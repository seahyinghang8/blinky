interface SvgProps {
  height?: number | string;
  width?: number | string;
  strokeWidth?: number | string;
}

export function GhostSvg({
  height = 24,
  width = 24,
  strokeWidth = 1.5,
}: SvgProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width}
      height={height}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
      className='lucide lucide-ghost'
    >
      <path d='M9 10h.01' />
      <path d='M15 10h.01' />
      <path d='M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z' />
    </svg>
  );
}

export function UserSvg({
  height = 24,
  width = 24,
  strokeWidth = 1.5,
}: SvgProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width}
      height={height}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
      className='lucide lucide-user'
    >
      <circle cx='12' cy='8' r='5' />
      <path d='M20 21a8 8 0 0 0-16 0Z' />
    </svg>
  );
}

export function ChevronRightSvg({
  height = 12,
  width = 12,
}: SvgProps) {
  return (
    <svg width={width} height={height} viewBox={`0 0 16 16`} xmlns="http://www.w3.org/2000/svg" fill="none" stroke='currentColor'>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"/>
    </svg>
  );
}

export function ChevronDownSvg({
  height = 12,
  width = 12,
}: SvgProps) {
  return (
    <svg width={width} height={height} viewBox={`0 0 16 16`} xmlns="http://www.w3.org/2000/svg" fill="none" stroke='currentColor'>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/>
    </svg>
  );
}

export function DiffSvg({
  height = 24,
  width = 24,
  strokeWidth = 1.5,
}: SvgProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={width}
      height={height}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth={strokeWidth}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <path d="M5.5 8C6.88071 8 8 6.88071 8 5.5C8 4.11929 6.88071 3 5.5 3C4.11929 3 3 4.11929 3 5.5C3 6.88071 4.11929 8 5.5 8ZM5.5 8V16M5.5 16C4.11929 16 3 17.1193 3 18.5C3 19.8807 4.11929 21 5.5 21C6.88071 21 8 19.8807 8 18.5C8 17.1193 6.88071 16 5.5 16ZM18.5 16V8.7C18.5 7.5799 18.5 7.01984 18.282 6.59202C18.0903 6.21569 17.7843 5.90973 17.408 5.71799C16.9802 5.5 16.4201 5.5 15.3 5.5H12M18.5 16C19.8807 16 21 17.1193 21 18.5C21 19.8807 19.8807 21 18.5 21C17.1193 21 16 19.8807 16 18.5C16 17.1193 17.1193 16 18.5 16ZM12 5.5L14.5 8M12 5.5L14.5 3"/>
    </svg>
  );
};
