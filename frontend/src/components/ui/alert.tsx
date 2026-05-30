import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 text-sm [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        destructive: "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive bg-destructive/10",
        success: "border-success/50 text-success dark:border-success [&>svg]:text-success bg-success/10",
        warning: "border-warning/50 text-warning dark:border-warning [&>svg]:text-warning bg-warning/10",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type AlertVariant = VariantProps<typeof alertVariants>["variant"];

export function Alert({
  className,
  variant,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="alert" role="alert" ref={ref} className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { AlertTitle } from "@/components/ui/alert-title";
export { AlertDescription } from "@/components/ui/alert-description";
