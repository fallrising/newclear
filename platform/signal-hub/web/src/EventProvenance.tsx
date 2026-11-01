import type { StoredEvent } from "./model";

export function RestoredBadge({ item }: { item: StoredEvent }) {
  return item.restored === true ? (
    <span className="restored-badge">已從封存匯回</span>
  ) : null;
}

export function RestoredNotice({ item }: { item: StoredEvent }) {
  return item.restored === true ? (
    <div className="notice restored-notice">
      <span>已從封存匯回：原始事件內容、序號與接收時間保持不變。</span>
    </div>
  ) : null;
}
