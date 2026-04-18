import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from './utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-bg-elevated text-text-secondary border border-bg-border',
        success: 'bg-success/15 text-success border border-success/25',
        warning: 'bg-warning/15 text-warning border border-warning/25',
        danger: 'bg-danger/15 text-danger border border-danger/25',
        accent: 'bg-accent/15 text-accent-hover border border-accent/25',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
