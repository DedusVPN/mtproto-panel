import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-btn text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover active:scale-[0.97] shadow-sm',
        secondary: 'bg-bg-elevated text-text-primary border border-bg-border hover:bg-bg-overlay hover:border-bg-overlay active:scale-[0.97]',
        ghost: 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated active:scale-[0.97]',
        danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 active:scale-[0.97]',
        success: 'bg-success/15 text-success border border-success/30 hover:bg-success/25 active:scale-[0.97]',
        accent: 'bg-accent/15 text-accent-hover border border-accent/30 hover:bg-accent/25 active:scale-[0.97]',
        icon: 'bg-transparent hover:bg-bg-elevated text-text-secondary hover:text-text-primary',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3.5',
        lg: 'h-10 px-5 text-base',
        icon: 'h-8 w-8 p-0',
        'icon-sm': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
)
Button.displayName = 'Button'
