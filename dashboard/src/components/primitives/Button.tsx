import type { ButtonHTMLAttributes } from 'react'

// The scoped stylesheet resets every button to transparent/borderless with
// higher specificity than single Tailwind utilities, so the two lawful
// button fills/borders are applied as inline styles here.
//
// PrimaryButton — the ONE allowed filled button (primary actions only).
// OutlineButton — the default secondary action: hairline border, hover
// moves text to white only (Law 3).

export function PrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-[10px] px-4 py-2.5 text-[13px] font-medium text-white transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      style={{ backgroundColor: '#5B8DEF' }}
      {...props}
    >
      {children}
    </button>
  )
}

export function OutlineButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-[10px] px-3 py-2 text-[12px] font-medium text-[#C9C9D1] transition-colors duration-150 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-[#C9C9D1] ${className}`}
      style={{ border: '1px solid #1C1C21' }}
      {...props}
    >
      {children}
    </button>
  )
}
