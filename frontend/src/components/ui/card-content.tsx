import { cn } from "@/lib/utils";

export function CardContent({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="card-content" ref={ref} className={cn("p-6 pt-0", className)} {...props} />;
}
