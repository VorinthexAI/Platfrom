import type { TableHTMLAttributes } from "react";
import { cn } from "../../utils";
export type TableProps = TableHTMLAttributes<HTMLTableElement>;
export function Table({ className, ...props }: TableProps) {
  return <table className={cn("vui-table", className)} {...props} />;
}
