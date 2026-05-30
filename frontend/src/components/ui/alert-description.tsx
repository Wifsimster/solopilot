import { cn } from "@/lib/utils";

export function AlertDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div data-slot="alert-description" ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
}
