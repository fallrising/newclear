import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchAfter, fetchLatest, fetchOlder, postMessage, probeMe } from "../api/messages";
import { RoomSync } from "./RoomSync";

/** One RoomSync per mounted room; stopped on unmount or room change (FM-SYNC-10). */
export function useRoomSync(roomId: string, meId: string): RoomSync | null {
  const queryClient = useQueryClient();
  const [sync, setSync] = useState<RoomSync | null>(null);
  useEffect(() => {
    const s = new RoomSync({
      roomId,
      meId,
      api: { fetchLatest, fetchOlder, fetchAfter, postMessage, probeMe },
      openSocket: (u) => new WebSocket(u),
      setTimer: (f, ms) => window.setTimeout(f, ms),
      clearTimer: (id) => window.clearTimeout(id),
      random: Math.random,
      onAuthLost: () => {
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      },
    });
    s.start();
    setSync(s);
    return () => {
      s.stop();
      setSync(null);
    };
  }, [roomId, meId, queryClient]);
  return sync;
}
