import { cn } from "@creezio/shell-ui";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200", className)} {...props} />;
}

export { Skeleton };
