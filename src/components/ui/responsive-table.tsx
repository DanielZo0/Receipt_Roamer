import * as React from "react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

const MobileCardList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid gap-3 md:hidden", className)} {...props} />
  ),
);
MobileCardList.displayName = "MobileCardList";

const MobileCard = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Card>>(
  ({ className, ...props }, ref) => (
    <Card ref={ref} className={cn("p-3 space-y-2", className)} {...props} />
  ),
);
MobileCard.displayName = "MobileCard";

const MobileCardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-start justify-between gap-2", className)} {...props} />
  ),
);
MobileCardHeader.displayName = "MobileCardHeader";

const MobileCardRow = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center justify-between gap-2 text-sm", className)} {...props} />
  ),
);
MobileCardRow.displayName = "MobileCardRow";

const MobileCardLabel = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} className={cn("text-xs text-muted-foreground flex-shrink-0", className)} {...props} />
  ),
);
MobileCardLabel.displayName = "MobileCardLabel";

export { MobileCardList, MobileCard, MobileCardHeader, MobileCardRow, MobileCardLabel };
