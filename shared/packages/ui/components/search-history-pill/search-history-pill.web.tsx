import type { HTMLAttributes } from "react";

import { Button } from "../button/button.web";
import { CloseIcon } from "../../icons/close/close.web";

export type SearchHistoryPillProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  count: number;
  disabled?: boolean;
  onPress: () => void;
  onRemove: () => void;
  query: string;
  removing?: boolean;
};

export function SearchHistoryPill({ count, disabled, onPress, onRemove, query, removing = false, className = "", ...props }: SearchHistoryPillProps) {
  return (
    <div className={`vui-search-history-pill ${className}`} {...props}>
      <Button aria-label={`Remove ${query} from search history`} disabled={disabled} icon={<CloseIcon size="sm" />} loading={removing} onClick={onRemove} size="sm" variant="icon">Remove search</Button>
      <Button aria-label={`Search for ${query}`} className="vui-search-history-pill-query" disabled={disabled || removing} onClick={onPress} size="md" variant="ghost">
        <span>{query}</span><span aria-label={`Used ${count} ${count === 1 ? "time" : "times"}`} className="vui-search-history-pill-badge">{count}x</span>
      </Button>
    </div>
  );
}
