import { cn } from "@/lib/utils";

export function CardContent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="card-content" ref={ref} className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
}
