import { cn } from "@/lib/utils";

export function Card({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="card" ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow", className)} {...props} />;
}

export function CardHeader({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="card-header" ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export { CardContent } from "@/components/ui/card-content";
