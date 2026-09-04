import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import type { Event as LoomEvent } from "../../contracts/Event";
import type { SessionId } from "../../contracts/SessionId";
import * as ipc from "../../ipc";

import { CSS, NODE_SIZE, PLACEMENT_STRIDE } from "./config";
import { DocumentNode } from "./DocumentNode";
import { TerminalNode } from "./TerminalNode";
import { TombstoneNode } from "./TombstoneNode";
import {
  type ContextSource,
  type EdgeKind,
  edgeStyleFor,
  inferKindFromHandles,
} from "./edges";
import {
  CANVAS_VERSION,
  hydrate,
  materializeEdge,
  readCanvasSidecar,
  serializeEdges,
  serializeNodes,
  writeCanvasSidecar,
  type HydratedDocumentSpec,
  type HydratedTerminalSpec,
} from "./persistence";

/// Stable node-types map. react-flow requires referential stability.
const NODE_TYPES: NodeTypes = {
  terminal: TerminalNode,
  document: DocumentNode,
  tombstone: TombstoneNode,
};

function contextSourceEq(
  a: ContextSource | undefined,
  b: ContextSource | undefined,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "doc"
    ? a.path === (b as { path: string }).path
    : a.sessionId === (b as { sessionId: string }).sessionId;
}

interface CanvasSurfaceProps {
  /// "add terminal" / "add document" — toggled by the App header.
  addTerminalAt: { x: number; y: number } | null;
  addDocumentAt: { x: number; y: number; path: string } | null;
  onConsumedAdd: () => void;
  onActiveTerminalChange?: (sid: SessionId | null) => void;
}

interface TerminalState {
  id: SessionId;
  exitCode?: number | null;
}

interface DocumentState {
  /// Stable node id for this open document. The path can repeat; the
  /// node id distinguishes occurrences and is what edges point from.
  nodeId: string;
  path: string;
}

interface LoomEdgeData {
  kind: EdgeKind;
}

export function CanvasSurface(props: CanvasSurfaceProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  addTerminalAt,
  addDocumentAt,
  onConsumedAdd,
  onActiveTerminalChange,
}: CanvasSurfaceProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [terminals, setTerminals] = useState<Map<string, TerminalState>>(
    () => new Map(),
  );
  // Node-id → {path}. Currently write-only; the next slice (multi-target
  // edges + sidecar persistence) will read it. Kept now so the wiring is
  // there and we don't have to thread state through later.
  const [, setDocuments] = useState<Map<string, DocumentState>>(
    () => new Map(),
  );
  // `hydrated` flips true after the on-mount load completes. The save
  // effect bails until then so we don't immediately overwrite the
  // sidecar with an empty canvas on first frame.
  const [hydrated, setHydrated] = useState(false);
  // docNodeId → `run_in:` frontmatter value. Updated by DocumentSurface
  // via onRunInChange; consumed by the synthetic-edges effect below to
  // materialize D-6 step 1's triggers edge.
  const [runInMap, setRunInMap] = useState<Map<string, string | null>>(
    () => new Map(),
  );

  // "Most recently added live terminal" is the implicit D-6 fallback.
  const activeTerminalId: SessionId | null = useMemo(() => {
    const arr = Array.from(terminals.values()).filter(
      (t) => t.exitCode === undefined,
    );
    return arr.length > 0 ? arr[arr.length - 1]!.id : null;
  }, [terminals]);

  useEffect(() => {
    onActiveTerminalChange?.(activeTerminalId);
  }, [activeTerminalId, onActiveTerminalChange]);

  // Resolver: for each document node, find an outgoing `triggers` edge
  // and look up its target node's SessionId. Falls back to the active
  // terminal if no edge exists.
  const triggersTargetFor = useCallback(
    (docNodeId: string): SessionId | null => {
      const outgoing = edges.find(
        (e) =>
          e.source === docNodeId &&
          (e.data as LoomEdgeData | undefined)?.kind === "triggers",
      );
      if (!outgoing) return activeTerminalId;
      const target = nodes.find((n) => n.id === outgoing.target);
      if (!target || target.type !== "terminal") return activeTerminalId;
      const data = target.data as { sessionId?: SessionId } | undefined;
      return data?.sessionId ?? activeTerminalId;
    },
    [edges, nodes, activeTerminalId],
  );

  // For each document node, find the terminals whose pty:io output
  // should be captured into the doc's runnable-block output sections.
  // These are the live `terminal`-typed sources of every incoming
  // `feeds_output_to` edge to the doc.
  const feedersFor = useCallback(
    (docNodeId: string): SessionId[] => {
      const out: SessionId[] = [];
      for (const e of edges) {
        if (e.target !== docNodeId) continue;
        if ((e.data as LoomEdgeData | undefined)?.kind !== "feeds_output_to") {
          continue;
        }
        const src = nodes.find((n) => n.id === e.source);
        if (!src || src.type !== "terminal") continue;
        const data = src.data as { sessionId?: SessionId } | undefined;
        if (data?.sessionId) out.push(data.sessionId);
      }
      return out;
    },
    [edges, nodes],
  );

  // For each document node, resolve every incoming `context_for` edge
  // into a ContextSource — a doc path if the source is a `document` node,
  // or a terminal session id if it's a `terminal` node. DocumentSurface
  // fetches the body (via doc_read or pty_scrollback) at send time.
  const contextSourcesFor = useCallback(
    (docNodeId: string): ContextSource[] => {
      const out: ContextSource[] = [];
      for (const e of edges) {
        if (e.target !== docNodeId) continue;
        if ((e.data as LoomEdgeData | undefined)?.kind !== "context_for") {
          continue;
        }
        const src = nodes.find((n) => n.id === e.source);
        if (!src) continue;
        if (src.type === "document") {
          const data = src.data as { path?: string } | undefined;
          if (data?.path) out.push({ kind: "doc", path: data.path });
        } else if (src.type === "terminal") {
          const data = src.data as
            | { sessionId?: SessionId; name?: string | null }
            | undefined;
          if (data?.sessionId) {
            const label = data.name ?? data.sessionId.slice(0, 8);
            out.push({
              kind: "terminal",
              sessionId: data.sessionId,
              label,
            });
          }
        }
      }
      return out;
    },
    [edges, nodes],
  );

  const removeNode = useCallback((id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const killTerminal = useCallback(async (sid: SessionId) => {
    try {
      await ipc.killPty(sid);
    } catch {
      /* ignore — node will be removed anyway */
    }
  }, []);

  const closeTerminal = useCallback(
    (sid: SessionId, nodeId: string) => {
      void killTerminal(sid);
      setTerminals((prev) => {
        const next = new Map(prev);
        next.delete(sid);
        return next;
      });
      removeNode(nodeId);
    },
    [killTerminal, removeNode],
  );

  const closeDocument = useCallback(
    (nodeId: string) => {
      setDocuments((prev) => {
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
      removeNode(nodeId);
    },
    [removeNode],
  );

  /// Rename a terminal (live) or tombstone. The optional name is used by
  /// the D-6 chain step 1: a document's `run_in: <name>` frontmatter
  /// resolves to the live (or about-to-be-restarted) terminal with the
  /// matching name.
  const renameTerminal = useCallback(
    (nodeId: string, name: string | null) => {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          if (n.type === "terminal") {
            return { ...n, data: { ...n.data, name } };
          }
          if (n.type === "tombstone") {
            const d = n.data as { was?: Record<string, unknown> };
            return {
              ...n,
              data: { ...n.data, was: { ...(d.was ?? {}), name } },
            };
          }
          return n;
        }),
      );
    },
    [],
  );

  /// Replace a tombstone with a fresh live terminal, reusing the old
  /// session's cwd/cmd/shell. Any edges pointing at the tombstone are
  /// rewritten to point at the new session — so a doc that was wired to
  /// the dead terminal keeps working.
  const restartTombstone = useCallback(
    async (
      tombNodeId: string,
      was: {
        cwd: string;
        cmd: string | null;
        shell: string;
        name?: string | null;
      },
    ) => {
      try {
        const newSid = await ipc.spawnPty({
          cwd: was.cwd,
          cmd: was.cmd,
          shell: was.shell,
          cols: 120,
          rows: 30,
        });
        const newNodeId = `t-${newSid}`;
        setTerminals((prev) => {
          const next = new Map(prev);
          next.set(newSid, { id: newSid });
          return next;
        });
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== tombNodeId) return n;
            return {
              ...n,
              id: newNodeId,
              type: "terminal",
              style: NODE_SIZE.terminal,
              data: {
                sessionId: newSid,
                // Carry the spawn config forward so persistence and a
                // future re-kill produce another tombstone with the
                // same `was`.
                cwd: was.cwd,
                cmd: was.cmd,
                shell: was.shell,
                name: was.name ?? null,
                onKill: () => void killTerminal(newSid),
                onClose: () => closeTerminal(newSid, newNodeId),
                onRename: (next: string | null) =>
                  renameTerminal(newNodeId, next),
              },
            };
          }),
        );
        setEdges((prev) =>
          prev.map((e) =>
            e.target === tombNodeId
              ? { ...e, target: newNodeId }
              : e.source === tombNodeId
                ? { ...e, source: newNodeId }
                : e,
          ),
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("restart failed", e);
      }
    },
    [closeTerminal, killTerminal, renameTerminal],
  );

  // Track refs so `useEffect`-spawned callbacks always read the latest
  // value without forcing the whole effect to re-run.
  const activeTerminalRef = useRef<SessionId | null>(activeTerminalId);
  useEffect(() => {
    activeTerminalRef.current = activeTerminalId;
  }, [activeTerminalId]);
  const triggersTargetForRef = useRef(triggersTargetFor);
  useEffect(() => {
    triggersTargetForRef.current = triggersTargetFor;
  }, [triggersTargetFor]);
  const feedersForRef = useRef(feedersFor);
  useEffect(() => {
    feedersForRef.current = feedersFor;
  }, [feedersFor]);
  const contextSourcesForRef = useRef(contextSourcesFor);
  useEffect(() => {
    contextSourcesForRef.current = contextSourcesFor;
  }, [contextSourcesFor]);
  const restartRef = useRef(restartTombstone);
  useEffect(() => {
    restartRef.current = restartTombstone;
  }, [restartTombstone]);
  const removeNodeRef = useRef(removeNode);
  useEffect(() => {
    removeNodeRef.current = removeNode;
  }, [removeNode]);

  // PtyExited listener: convert the live terminal node to a tombstone
  // carrying enough metadata to one-click restart it.
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const off = await ipc.onLoomEvent(async (ev: LoomEvent) => {
        if (ev.kind !== "pty_exited") return;
        setTerminals((prev) => {
          const next = new Map(prev);
          const existing = next.get(ev.session_id);
          if (!existing) return prev;
          next.set(ev.session_id, { ...existing, exitCode: ev.exit_code });
          return next;
        });
        let meta: Awaited<ReturnType<typeof ipc.sessionMeta>> = null;
        try {
          meta = await ipc.sessionMeta(ev.session_id);
        } catch {
          /* fall back to defaults */
        }
        setNodes((prev) =>
          prev.map((n) => {
            if (n.type !== "terminal") return n;
            const data = n.data as {
              sessionId?: SessionId;
              name?: string | null;
            };
            if (data.sessionId !== ev.session_id) return n;
            const tombId = n.id;
            const was = meta
              ? {
                  cwd: meta.cwd,
                  cmd: meta.cmd,
                  shell: meta.shell,
                  name: data.name ?? null,
                }
              : {
                  cwd: "~",
                  cmd: null,
                  shell: "/bin/sh",
                  name: data.name ?? null,
                };
            return {
              ...n,
              type: "tombstone",
              style: NODE_SIZE.tombstone,
              data: {
                reason:
                  ev.exit_code === null || ev.exit_code === 0
                    ? "exited"
                    : `exited with code ${ev.exit_code}`,
                was,
                exitCode: ev.exit_code,
                onRestart: () => void restartRef.current(tombId, was),
                onDismiss: () => removeNodeRef.current(tombId),
              },
            };
          }),
        );
      });
      if (alive) unlisten = off;
      else off();
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // On mount: load the canvas sidecar and rehydrate nodes + edges.
  // Terminals come back as tombstones (their session_id was ephemeral);
  // documents come back as-is. Edges keep their kind. Runs once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sidecar = await readCanvasSidecar();
      if (cancelled) return;
      if (!sidecar) {
        setHydrated(true);
        return;
      }
      const { nodes: nodeSpecs, edges: edgeSpecs } = hydrate(sidecar);
      const restoredNodes: Node[] = nodeSpecs.map((spec) => {
        if (spec.kind === "document") {
          const s = spec as HydratedDocumentSpec;
          return {
            id: s.id,
            type: "document",
            position: s.position,
            data: {
              path: s.path,
              triggersTarget: null,
              feedingTerminalIds: [],
              pinnedContextSources: [],
              onClose: () => closeDocument(s.id),
              onRunInChange: (name: string | null) =>
                onRunInChange(s.id, name),
            },
            style: NODE_SIZE.document,
          };
        }
        const s = spec as HydratedTerminalSpec;
        return {
          id: s.id,
          type: "tombstone",
          position: s.position,
          data: {
            reason: s.reason,
            was: s.was,
            // No exit code persisted; restart uses the saved `was`.
            onRestart: () => void restartRef.current(s.id, s.was),
            onDismiss: () => removeNodeRef.current(s.id),
          },
          style: NODE_SIZE.tombstone,
        };
      });
      setNodes(restoredNodes);
      setEdges(edgeSpecs.map(materializeEdge));
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // closeDocument is stable through useCallback; restartRef/removeNodeRef
    // are refs. Load runs exactly once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save: whenever nodes or edges change after hydration,
  // serialize and write back to `.loom/canvas.json`. 500 ms is short
  // enough to feel "live" yet long enough to coalesce drag streams.
  // Synthetic edges (materialized from `run_in:` frontmatter, see below)
  // are filtered out by `serializeEdges` so they never touch disk.
  useEffect(() => {
    if (!hydrated) return;
    const handle = window.setTimeout(() => {
      const payload = {
        version: CANVAS_VERSION,
        nodes: serializeNodes(nodes),
        edges: serializeEdges(edges),
      };
      void writeCanvasSidecar(payload).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("canvas.json save failed", e);
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [hydrated, nodes, edges]);

  // D-6 step 1: materialize each `run_in: <name>` from a document's
  // frontmatter as a synthetic `triggers` edge from the document node
  // to the live terminal node carrying that name. Re-runs whenever the
  // run_in map, nodes (their names), or live terminals change.
  //
  // Synthetic edges are tagged with `data.synthetic = true` so:
  //   - `serializeEdges` filters them out (frontmatter is the on-disk
  //     truth; we recompute on every load).
  //   - `triggersTargetFor` sees them first (we put them at the front of
  //     the edges array) so they outrank a user-drawn triggers edge,
  //     matching the chain order in TDD §5.2.
  useEffect(() => {
    setEdges((prev) => {
      const userEdges = prev.filter(
        (e) => !(e.data as unknown as LoomEdgeData & { synthetic?: boolean })?.synthetic,
      );
      // Build name → live terminal node-id.
      const nameToNodeId = new Map<string, string>();
      for (const n of nodes) {
        if (n.type !== "terminal") continue;
        const d = n.data as { name?: string | null };
        if (d.name) nameToNodeId.set(d.name, n.id);
      }
      const synthetic: Edge[] = [];
      runInMap.forEach((name, docId) => {
        if (!name) return;
        const targetId = nameToNodeId.get(name);
        if (!targetId) return;
        const styling = edgeStyleFor("triggers");
        synthetic.push({
          id: `e-runin-${docId}`,
          source: docId,
          // Documents have a `triggers` source handle on the right (id
          // "out"), terminals a `triggers` target on the left (id "in").
          // Skipping these on a multi-handle node silently drops the edge.
          sourceHandle: "out",
          target: targetId,
          targetHandle: "in",
          type: "default",
          style: { ...styling.style, strokeDasharray: "6 4" },
          markerEnd: styling.markerEnd,
          label: `${styling.label} via run_in`,
          labelStyle: { fill: "#e6e6e6", fontSize: 11 },
          labelBgStyle: { fill: "#161616" },
          data: { kind: "triggers", synthetic: true },
        });
      });
      // No change? Return prev so we don't churn the save effect.
      const prevSyntheticIds = prev
        .filter(
          (e) => (e.data as unknown as LoomEdgeData & { synthetic?: boolean })?.synthetic,
        )
        .map((e) => `${e.id}|${e.source}|${e.target}`)
        .sort();
      const nextSyntheticIds = synthetic
        .map((e) => `${e.id}|${e.source}|${e.target}`)
        .sort();
      if (
        prevSyntheticIds.length === nextSyntheticIds.length &&
        prevSyntheticIds.every((v, i) => v === nextSyntheticIds[i])
      ) {
        return prev;
      }
      // Synthetic edges go first so `triggersTargetFor` picks them ahead
      // of any user-drawn `triggers` edge from the same source.
      return [...synthetic, ...userEdges];
    });
  }, [runInMap, nodes]);

  const onRunInChange = useCallback(
    (docNodeId: string, name: string | null) => {
      setRunInMap((prev) => {
        const existing = prev.get(docNodeId) ?? null;
        if (existing === name) return prev;
        const next = new Map(prev);
        if (name === null) next.delete(docNodeId);
        else next.set(docNodeId, name);
        return next;
      });
    },
    [],
  );

  // Spawn a new terminal node when the App signals.
  useEffect(() => {
    if (!addTerminalAt) return;
    let cancelled = false;
    void (async () => {
      try {
        const cwd = await ipc.homeDir();
        const sid = await ipc.spawnPty({
          cwd,
          cmd: null,
          shell: null,
          cols: 120,
          rows: 30,
        });
        if (cancelled) return;
        // Pull the resolved cwd/cmd/shell so persistence has the durable
        // values (the backend defaulted shell from $SHELL).
        const meta = await ipc.sessionMeta(sid);
        const nodeId = `t-${sid}`;
        setTerminals((prev) => {
          const next = new Map(prev);
          next.set(sid, { id: sid });
          return next;
        });
        setNodes((prev) => [
          ...prev,
          {
            id: nodeId,
            type: "terminal",
            position: addTerminalAt,
            data: {
              sessionId: sid,
              cwd: meta?.cwd ?? cwd,
              cmd: meta?.cmd ?? null,
              shell: meta?.shell ?? "/bin/sh",
              name: null,
              onKill: () => void killTerminal(sid),
              onClose: () => closeTerminal(sid, nodeId),
              onRename: (next: string | null) =>
                renameTerminal(nodeId, next),
            },
            style: NODE_SIZE.terminal,
          },
        ]);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("spawnPty failed", e);
      } finally {
        onConsumedAdd();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addTerminalAt, closeTerminal, killTerminal, onConsumedAdd, renameTerminal]);

  // Add a document node when the App signals.
  useEffect(() => {
    if (!addDocumentAt) return;
    const { x, y, path } = addDocumentAt;
    const nodeId = `d-${path}-${Date.now()}`;
    setDocuments((prev) => {
      const next = new Map(prev);
      next.set(nodeId, { nodeId, path });
      return next;
    });
    setNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type: "document",
        position: { x, y },
        data: {
          path,
          triggersTarget: triggersTargetForRef.current(nodeId),
          feedingTerminalIds: feedersForRef.current(nodeId),
          pinnedContextSources: contextSourcesForRef.current(nodeId),
          onClose: () => closeDocument(nodeId),
          onRunInChange: (name: string | null) =>
            onRunInChange(nodeId, name),
        },
        style: NODE_SIZE.document,
      },
    ]);
    onConsumedAdd();
  }, [addDocumentAt, closeDocument, onConsumedAdd]);

  // Whenever the D-6 resolution might have changed (active terminal,
  // edges, or terminal set), push the freshly-resolved triggersTarget
  // and feedingTerminalIds into every document node's data so its ▶
  // click knows where to land and its output capture knows whom to
  // listen to.
  //
  // CRITICAL: this effect MUST be a no-op when nothing actually changed.
  // `triggersTargetFor` and `feedersFor` are useCallbacks that depend on
  // `nodes`, so calling `setNodes` with a freshly mapped array creates a
  // new node identity → new callback identity → effect re-runs → infinite
  // loop. We bail out and return the previous array reference when the
  // resolved values are equal to what's already stored.
  useEffect(() => {
    // Build name→nodeId once per effect run for the runIn status check.
    const nameToNodeId = new Map<string, string>();
    for (const n of nodes) {
      if (n.type !== "terminal") continue;
      const d = n.data as { name?: string | null };
      if (d.name) nameToNodeId.set(d.name, n.id);
    }
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        if (n.type !== "document") return n;
        const newTarget = triggersTargetFor(n.id);
        const newFeeders = feedersFor(n.id);
        const newPinned = contextSourcesFor(n.id);
        const newRunInName = runInMap.get(n.id) ?? null;
        const newRunInMatched =
          newRunInName !== null && nameToNodeId.has(newRunInName);
        const oldData = n.data as {
          triggersTarget?: SessionId | null;
          feedingTerminalIds?: SessionId[];
          pinnedContextSources?: ContextSource[];
          runInName?: string | null;
          runInMatched?: boolean;
        };
        const oldTarget = oldData.triggersTarget ?? null;
        const oldFeeders = oldData.feedingTerminalIds ?? [];
        const oldPinned = oldData.pinnedContextSources ?? [];
        const oldRunInName = oldData.runInName ?? null;
        const oldRunInMatched = oldData.runInMatched ?? false;
        const targetSame = oldTarget === newTarget;
        const feedersSame =
          oldFeeders.length === newFeeders.length &&
          oldFeeders.every((v, i) => v === newFeeders[i]);
        const pinnedSame =
          oldPinned.length === newPinned.length &&
          oldPinned.every((v, i) => contextSourceEq(v, newPinned[i]));
        const runInSame =
          oldRunInName === newRunInName &&
          oldRunInMatched === newRunInMatched;
        if (targetSame && feedersSame && pinnedSame && runInSame) return n;
        changed = true;
        return {
          ...n,
          data: {
            ...n.data,
            triggersTarget: newTarget,
            feedingTerminalIds: newFeeders,
            pinnedContextSources: newPinned,
            runInName: newRunInName,
            runInMatched: newRunInMatched,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [triggersTargetFor, feedersFor, contextSourcesFor, runInMap, nodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      const sourceNode = nodes.find((n) => n.id === conn.source);
      const targetNode = nodes.find((n) => n.id === conn.target);
      const kind = inferKindFromHandles(
        sourceNode?.type as "document" | "terminal" | "tombstone" | undefined,
        targetNode?.type as "document" | "terminal" | "tombstone" | undefined,
        conn.sourceHandle,
      );
      if (!kind) return;
      const styling = edgeStyleFor(kind);
      const newEdge: Edge = {
        ...conn,
        id: `e-${conn.source}-${conn.target}-${kind}-${Date.now()}`,
        type: "default",
        style: styling.style,
        markerEnd: styling.markerEnd,
        label: styling.label,
        labelStyle: { fill: "#e6e6e6", fontSize: 12 },
        labelBgStyle: { fill: "#161616" },
        data: { kind } satisfies LoomEdgeData,
      };
      setEdges((eds) => addEdge(newEdge, eds));
    },
    [nodes],
  );

  return (
    <div className={CSS.canvasRoot}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        minZoom={0.2}
        maxZoom={2}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        // Backspace deletes selected edges — same UX as the rest of the
        // app, and harmless inside the editor since CodeMirror swallows
        // keys before they bubble.
        deleteKeyCode={["Backspace", "Delete"]}
        nodesConnectable
        elementsSelectable
        nodeDragThreshold={4}
      >
        <Background gap={32} size={1} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <span>
            Empty canvas — use "+ terminal" or "+ document" in the header to drop
            a node, then drag from a document's right edge to a terminal's left
            edge to route ▶ injections.
          </span>
        </div>
      )}
    </div>
  );
}

/// Helper for the App to compute placement coordinates that don't overlap.
export function pickNextPosition(usedCount: number): { x: number; y: number } {
  return {
    x: 60 + usedCount * PLACEMENT_STRIDE.x,
    y: 60 + usedCount * PLACEMENT_STRIDE.y,
  };
}
