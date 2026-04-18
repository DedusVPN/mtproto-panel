import * as React from 'react'
import { cn } from './utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded-btn bg-bg-elevated border border-bg-border px-3 py-1.5 text-sm text-text-primary',
        'placeholder:text-text-muted',
        'transition-colors duration-150',
        'focus:outline-none focus:border-accent/60 focus:bg-bg-overlay focus:ring-1 focus:ring-accent/20',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
