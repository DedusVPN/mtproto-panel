import * as React from 'react'
import { cn } from './utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex w-full rounded-btn bg-bg-elevated border border-bg-border px-3 py-2 text-sm text-text-primary',
        'placeholder:text-text-muted font-mono',
        'resize-y min-h-[80px]',
        'transition-colors duration-150',
        'focus:outline-none focus:border-accent/60 focus:bg-bg-overlay focus:ring-1 focus:ring-accent/20',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className
      )}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'
