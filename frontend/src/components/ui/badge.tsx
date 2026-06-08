import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive/12 text-destructive dark:bg-destructive/20",
        outline: "border-border text-foreground",
        success:
          "border-transparent bg-success/12 text-success dark:bg-success/20",
        warning:
          "border-transparent bg-warning/15 text-warning dark:bg-warning/25",
        error:
          "border-transparent bg-destructive/12 text-destructive dark:bg-destructive/20",
        brand:
          "border-transparent bg-accent text-accent-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

export function Badge({
  className,
  variant,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      data-slot="badge"
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}
