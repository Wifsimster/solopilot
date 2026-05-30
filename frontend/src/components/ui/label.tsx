import { cn } from "@/lib/utils";

export function Label({
  className,
  ref,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { ref?: React.Ref<HTMLLabelElement> }) {
  return (
    // react-doctor-disable-next-line react-doctor/label-has-associated-control -- reusable primitive; consumers always associate it via the htmlFor passed through {...props}
    <label
      data-slot="label"
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  );
}
