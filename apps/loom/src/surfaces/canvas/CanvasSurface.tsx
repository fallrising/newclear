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
  type OnBeforeDelete,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import type { Event as LoomEvent } from "../../contracts/Event";
import type { SessionId } from "../../contracts/SessionId";
import type { SessionMeta } from "../../contracts/SessionMeta";
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
  serializeEdges,
  serializeNodes,
  type HydratedDocumentSpec,
  type HydratedTerminalSpec,
} from "./persistence";

import { WindowCloseCoordinator, type WindowCloseState } from "./window_close";
import { approveWindowClose, onWindowCloseRequested } from "./window_close_ipc";
import type { WindowCloseParticipant } from "../document/window_participant";

import { CanvasStorage, removalPlan, withoutKeys } from "./lifecycle";
import { SessionHistory } from "./SessionHistory";
import { appendHistoryNode, withObservedExit, type AttachmentOptions } from "./recoveryCanvas";
import { cleanupUnattachedSession } from "./history";

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
  const storageRef = useRef(new CanvasStorage());
  const [readError, setReadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cleanupErrors, setCleanupErrors] = useState<Map<string, string>>(() => new Map());
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [spawnError, setSpawnError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const hydratedRef = useRef(hydrated);
  const observedExitsRef = useRef(new Map<string, number | null>());
  hydratedRef.current = hydrated;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const canvasOperationsRef = useRef(0);
  const pendingAddsRef = useRef(false);
  pendingAddsRef.current = !!addDocumentAt || !!addTerminalAt;
  const saveTimerRef = useRef<number | null>(null);
  const [windowClose, setWindowClose] = useState<WindowCloseState>({ phase: "idle", error: null });
  const [windowListenerError, setWindowListenerError] = useState<string | null>(null);
  const [listenerAttempt, setListenerAttempt] = useState(0);
  const promptRef = useRef<HTMLDivElement>(null);
  const coordinatorRef = useRef<WindowCloseCoordinator | null>(null);
  if (!coordinatorRef.current) coordinatorRef.current = new WindowCloseCoordinator({
    expected: () => !hydratedRef.current || canvasOperationsRef.current > 0 || pendingAddsRef.current
      ? null : nodesRef.current.filter((node) => node.type === "document").map((node) => node.id),
    flush: async () => {
      // A failed hydration must preserve the unread original sidecar. Discard
      // can still exit; no guessed/empty canvas is ever written over that file.
      if (!hydratedRef.current) return;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      await storageRef.current.save({ version: CANVAS_VERSION,
        nodes: serializeNodes(nodesRef.current), edges: serializeEdges(edgesRef.current) });
    },
    approve: approveWindowClose,
    changed: setWindowClose,
  });
  const coordinator = coordinatorRef.current;
  const workspaceBlocked = useCallback(() => coordinator.state.phase !== "idle", [coordinator]);
  const registerWindowCloseParticipant = useCallback((id: string, participant: WindowCloseParticipant) =>
    coordinator.register(id, participant), [coordinator]);

  useEffect(() => {
    coordinator.activate();
    return () => coordinator.dispose();
  }, [coordinator]);
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    void onWindowCloseRequested(() => { if (alive) void coordinator.request(); }).then((off) => {
      if (alive) { unlisten = off; setWindowListenerError(null); } else off();
    }, (error) => { if (alive) setWindowListenerError(`Window close listener failed: ${String(error)}. Native close remains blocked.`); });
    return () => { alive = false; unlisten?.(); };
  }, [coordinator, listenerAttempt]);

  // Capture on document also covers the App header and an editor that retained
  // focus. Reading controller state makes the final freeze synchronous, before
  // React renders disabled controls or native destruction resolves.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const intercept = (event: Event) => {
      if (!workspaceBlocked()) return;
      const prompt = promptRef.current;
      const key = event as KeyboardEvent;
      if (key.type === "keydown" && key.key === "Escape" && coordinator.state.phase !== "committing") {
        event.preventDefault(); event.stopImmediatePropagation(); coordinator.cancel(); return;
      }
      if (coordinator.state.phase !== "committing" && prompt?.contains(event.target as globalThis.Node)) {
        if (key.type === "keydown" && key.key === "Tab") {
          const buttons = Array.from(prompt.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = (index + (key.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
          event.preventDefault(); buttons[next]?.focus();
        }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      prompt?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    };
    const events = ["pointerdown", "mousedown", "click", "dblclick", "keydown", "keyup", "beforeinput", "input", "paste", "cut", "drop", "wheel"];
    events.forEach((event) => document.addEventListener(event, intercept, { capture: true, passive: false }));
    return () => events.forEach((event) => document.removeEventListener(event, intercept, true));
  }, [coordinator, workspaceBlocked]);
  const windowPromptOpen = windowClose.phase !== "idle";
  useEffect(() => {
    if (!windowPromptOpen || typeof document === "undefined" || !promptRef.current) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const hidden: Array<{ element: HTMLElement; inert: boolean }> = [];
    // Hide nested document prompts from accessibility and make every sibling,
    // including the App header, inert while this one modal owns the decision.
    let branch: HTMLElement = promptRef.current;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          hidden.push({ element: sibling, inert: sibling.inert }); sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    promptRef.current.querySelector<HTMLButtonElement>("[data-window-cancel]")?.focus();
    return () => {
      hidden.forEach(({ element, inert }) => { element.inert = inert; });
      previousFocus?.focus();
    };
  }, [windowPromptOpen]);
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

  const killTerminal = useCallback(async (sid: SessionId) => {
    try {
      await ipc.killPty(sid);
      setCleanupErrors((prev) => withoutKeys(prev, [sid]));
    } catch (e) {
      setCleanupErrors((prev) => new Map(prev).set(sid, String(e)));
    }
  }, []);

  // Registrations are runtime-only. Each entry owns its cleanup, including
  // when the same callback is registered again during a lifetime transition.
  const closeGuardsRef = useRef(new Map<string, { requestClose: () => void }>());
  const registerCloseGuard = useCallback((id: string, requestClose: () => void) => {
    const entry = { requestClose };
    closeGuardsRef.current.set(id, entry);
    return () => {
      if (closeGuardsRef.current.get(id) === entry) closeGuardsRef.current.delete(id);
    };
  }, []);

  // Approved document Close bypasses the request guard. Non-document removal
  // shares this cleanup, with nodesRef preventing duplicate terminal cleanup.
  const removeNode = useCallback((id: string) => {
    // A document close approved before the window prompt may finish now.
    // Honour it: its lifecycle has already relinquished ownership. Window
    // Save all detects the resulting membership change before native dispatch.
    if (!nodesRef.current.some((node) => node.id === id)) return;
    closeGuardsRef.current.delete(id);
    const plan = removalPlan(nodesRef.current, [id]);
    nodesRef.current = nodesRef.current.filter((n) => n.id !== id);
    plan.sessions.forEach((sid) => { void killTerminal(sid); });
    setTerminals((prev) => withoutKeys(prev, plan.sessions));
    setDocuments((prev) => withoutKeys(prev, plan.documents));
    setRunInMap((prev) => withoutKeys(prev, [id]));
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
  }, [killTerminal]);

  const closeTerminal = useCallback(
    (_sid: SessionId, nodeId: string) => removeNode(nodeId),
    [removeNode],
  );
  const closeDocument = removeNode;

  const requestNodeRemoval = useCallback((id: string) => {
    if (workspaceBlocked()) return;
    const node = nodesRef.current.find((current) => current.id === id);
    if (node?.type === "document") {
      // Missing registration fails closed: the editor may still be mounting.
      closeGuardsRef.current.get(id)?.requestClose();
    } else if (node) {
      removeNode(id);
    }
  }, [removeNode]);

  const onBeforeDelete = useCallback<OnBeforeDelete>(async ({ nodes: requestedNodes, edges: requestedEdges }) => {
    if (workspaceBlocked()) return false;
    const documents = new Set(requestedNodes.filter((node) => node.type === "document").map((node) => node.id));
    documents.forEach(requestNodeRemoval);
    // React Flow emits incident edge removals BEFORE node removals. Keep both
    // under the document's approved-close path, even if it approved instantly.
    // Edges independently selected without that document remain deletable.
    return {
      nodes: requestedNodes.filter((node) => !documents.has(node.id)),
      edges: requestedEdges.filter((edge) => !documents.has(edge.source) && !documents.has(edge.target)),
    };
  }, [requestNodeRemoval]);

  /// Rename a terminal (live) or tombstone. The optional name is used by
  /// the D-6 chain step 1: a document's `run_in: <name>` frontmatter
  /// resolves to the live (or about-to-be-restarted) terminal with the
  /// matching name.
  const renameTerminal = useCallback(
    (nodeId: string, name: string | null) => {
      if (workspaceBlocked()) return;
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
  const pendingRestartsRef = useRef(new Set<string>());
  const attachSessionRef = useRef<(meta: SessionMeta, options?: AttachmentOptions) => boolean>(() => false);
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
      if (workspaceBlocked() || !mountedRef.current || !hydratedRef.current || pendingRestartsRef.current.has(tombNodeId)) return;
      const currentNode = nodesRef.current.find((node) => node.id === tombNodeId);
      if (!currentNode || currentNode.type !== "tombstone") return;
      // Read the current name/config instead of a pre-rename callback snapshot.
      was = currentNode.data.was as typeof was;
      pendingRestartsRef.current.add(tombNodeId);
      canvasOperationsRef.current++;
      setSpawnError(null);
      let spawnedId: SessionId | null = null;
      try {
        const newSid = await ipc.spawnPty({
          cwd: was.cwd,
          cmd: was.cmd,
          shell: was.shell,
          cols: 120,
          rows: 30,
        });
        spawnedId = newSid;
        if (!mountedRef.current || !nodesRef.current.some((node) => node.id === tombNodeId)) {
          await cleanupUnattachedSession(newSid, ipc.killPty);
          spawnedId = null;
          return;
        }
        const meta = await ipc.sessionMeta(newSid);
        if (!meta) throw new Error("New session metadata is unavailable");
        if (!attachSessionRef.current(meta, { replaceNodeId: tombNodeId, name: was.name })) {
          await cleanupUnattachedSession(newSid, ipc.killPty);
        }
        spawnedId = null;
      } catch (e) {
        if (spawnedId) await cleanupUnattachedSession(spawnedId, ipc.killPty);
        if (mountedRef.current) setSpawnError(`Restart failed: ${String(e)}. The saved node is unchanged; try Restart again.`);
      } finally {
        pendingRestartsRef.current.delete(tombNodeId);
        canvasOperationsRef.current--;
      }
    },
    [],
  );

  const attachSession = useCallback((meta: SessionMeta, options: AttachmentOptions = {}) => {
    if (workspaceBlocked() || !mountedRef.current || !hydratedRef.current) return false;
    if (options.replaceNodeId && !nodesRef.current.some((node) => node.id === options.replaceNodeId)) return false;
    meta = withObservedExit(meta, observedExitsRef.current);
    const position = options.position ?? pickNextPosition(nodesRef.current.length);
    const hooks = {
      kill: (sid: string) => { void killTerminal(sid); }, close: closeTerminal, rename: renameTerminal,
      restart: (id: string, was: { cwd: string; cmd: string | null; shell: string; name: string | null }) => { void restartTombstone(id, was); },
      dismiss: removeNode,
    };
    nodesRef.current = appendHistoryNode(nodesRef.current, meta, position, hooks, options);
    setNodes((prev) => appendHistoryNode(prev, meta, position, hooks, options));
    if (meta.state.kind !== "exited" && meta.state.kind !== "tombstone") {
      setTerminals((prev) => new Map(prev).set(meta.id, { id: meta.id }));
    }
    if (options.replaceNodeId) {
      const oldId = options.replaceNodeId;
      const newId = `t-${meta.id}`;
      setEdges((prev) => prev.map((edge) => ({ ...edge,
        source: edge.source === oldId ? newId : edge.source,
        target: edge.target === oldId ? newId : edge.target,
      })));
    }
    return true;
  }, [killTerminal, closeTerminal, renameTerminal, restartTombstone, removeNode]);
  attachSessionRef.current = attachSession;

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
        if (!alive || ev.kind !== "pty_exited") return;
        observedExitsRef.current.set(ev.session_id, ev.exit_code);
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
        if (!alive) return;
        setNodes((prev) =>
          prev.map((n) => {
            if (n.type !== "terminal") return n;
            const data = n.data as {
              sessionId?: SessionId;
              name?: string | null;
              cwd?: string;
              cmd?: string | null;
              shell?: string;
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
                  cwd: data.cwd ?? "~",
                  cmd: data.cmd ?? null,
                  shell: data.shell ?? "/bin/sh",
                  name: data.name ?? null,
                };
            return {
              ...n,
              type: "tombstone",
              data: {
                sidecarGroup: n.data.sidecarGroup,
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
  // documents come back as-is. Edges keep their kind. Retry rereads only after failure.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setHydrated(false);
      setReadError(null);
      try {
        const sidecar = await storageRef.current.load();
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
                sidecarGroup: s.group,
                triggersTarget: null,
                feedingTerminalIds: [],
                pinnedContextSources: [],
                onClose: () => closeDocument(s.id),
                registerCloseGuard: (requestClose: () => void) => registerCloseGuard(s.id, requestClose),
                registerWindowCloseParticipant: (participant: WindowCloseParticipant) => registerWindowCloseParticipant(s.id, participant),
                onRunInChange: (name: string | null) =>
                  onRunInChange(s.id, name),
              },
              style: { width: s.width, height: s.height },
            };
          }
          const s = spec as HydratedTerminalSpec;
          return {
            id: s.id,
            type: "tombstone",
            position: s.position,
            data: {
              sidecarGroup: s.group,
              reason: s.reason,
              was: s.was,
              // No exit code persisted; restart uses the saved `was`.
              onRestart: () => void restartRef.current(s.id, s.was),
              onDismiss: () => removeNodeRef.current(s.id),
            },
            style: { width: s.width, height: s.height },
          };
        });
        setNodes(restoredNodes);
        setEdges(edgeSpecs.map(materializeEdge));
        setHydrated(true);
      } catch (e) {
        if (!cancelled) setReadError(`Canvas could not be opened: ${String(e)}. Original file preserved; autosave disabled.`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // closeDocument is stable through useCallback; restartRef/removeNodeRef
    // are refs. Retry is explicit and remains blocked until a successful read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAttempt]);

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
      void storageRef.current.save(payload).then(
        () => setSaveError(null),
        (e) => setSaveError(`Canvas save failed: ${String(e)}`),
      );
    }, 500);
    saveTimerRef.current = handle;
    return () => window.clearTimeout(handle);
  }, [hydrated, nodes, edges, saveAttempt]);

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
        if (!name || !nodes.some((n) => n.id === docId && n.type === "document")) return;
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
    if (!hydrated || !addTerminalAt || workspaceBlocked()) return;
    canvasOperationsRef.current++;
    let cancelled = false;
    let spawnedId: SessionId | null = null;
    void (async () => {
      try {
        const cwd = await ipc.homeDir();
        if (cancelled) return;
        setSpawnError(null);
        const sid = await ipc.spawnPty({
          cwd,
          cmd: null,
          shell: null,
          cols: 120,
          rows: 30,
        });
        spawnedId = sid;
        if (cancelled) { await cleanupUnattachedSession(sid, ipc.killPty); spawnedId = null; return; }
        // Pull the resolved cwd/cmd/shell so persistence has the durable
        // values (the backend defaulted shell from $SHELL).
        const meta = await ipc.sessionMeta(sid);
        if (cancelled) { await cleanupUnattachedSession(sid, ipc.killPty); spawnedId = null; return; }
        if (!meta) throw new Error("New session metadata is unavailable");
        if (!attachSessionRef.current(meta, { position: addTerminalAt })) await cleanupUnattachedSession(sid, ipc.killPty);
        spawnedId = null;
      } catch (e) {
        if (!cancelled) setSpawnError(`Terminal could not be started: ${String(e)}. Try adding a terminal again.`);
        if (spawnedId) await cleanupUnattachedSession(spawnedId, ipc.killPty);
      } finally {
        canvasOperationsRef.current--;
        if (!cancelled) onConsumedAdd();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, addTerminalAt, onConsumedAdd, windowClose.phase, workspaceBlocked]);

  // Add a document node when the App signals.
  useEffect(() => {
    if (!hydrated || !addDocumentAt || workspaceBlocked()) return;
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
          registerCloseGuard: (requestClose: () => void) => registerCloseGuard(nodeId, requestClose),
          registerWindowCloseParticipant: (participant: WindowCloseParticipant) => registerWindowCloseParticipant(nodeId, participant),
          onRunInChange: (name: string | null) =>
            onRunInChange(nodeId, name),
        },
        style: NODE_SIZE.document,
      },
    ]);
    onConsumedAdd();
  }, [hydrated, addDocumentAt, closeDocument, registerCloseGuard, onConsumedAdd, windowClose.phase, workspaceBlocked]);

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
    if (workspaceBlocked()) return;
    changes.forEach((change) => { if (change.type === "remove") requestNodeRemoval(change.id); });
    const otherChanges = changes.filter((change) => change.type !== "remove");
    setNodes((nds) => applyNodeChanges(otherChanges, nds));
  }, [requestNodeRemoval]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (workspaceBlocked()) return;
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (workspaceBlocked() || !conn.source || !conn.target || conn.source === conn.target) return;
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
      <SessionHistory canvasReady={hydrated && windowClose.phase === "idle"} onRestarted={attachSession} />
      {windowListenerError && <div role="alert" style={{ position: "absolute", zIndex: 22, top: 60, left: 16, background: "#402020", padding: 12 }}>
        {windowListenerError} <button onClick={() => setListenerAttempt((attempt) => attempt + 1)}>Retry window close listener</button>
      </div>}
      {windowClose.phase !== "idle" && <div ref={promptRef} role="dialog" aria-modal={true} aria-labelledby="window-close-title"
        style={{ position: "fixed", inset: 0, zIndex: 10000, background: "#111e", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <h2 id="window-close-title">Close Loom?</h2>
        <p>Save changes to all open documents before exiting?</p>
        {windowClose.error && <p role="alert">{windowClose.error}</p>}
        {windowClose.phase === "saving" && <p role="status">Finishing saves… Cancel keeps the window open; submitted writes may finish.</p>}
        {windowClose.phase === "committing" && <p role="status">Closing window…</p>}
        <button disabled={windowClose.phase !== "prompt"} onClick={() => void coordinator.saveAll()}>Save all and exit</button>
        <button disabled={windowClose.phase !== "prompt"} onClick={() => void coordinator.discard()}>Discard and exit</button>
        <button data-window-cancel disabled={windowClose.phase === "committing"} onClick={() => coordinator.cancel()}>Cancel</button>
      </div>}
      {spawnError && <div role="alert" style={{ position: "absolute", zIndex: 21, bottom: 80, left: 16, background: "#402020", padding: 12 }}>
        {spawnError} <button onClick={() => setSpawnError(null)}>Dismiss</button>
      </div>}
      {cleanupErrors.size > 0 && <div role="alert" style={{ position: "absolute", zIndex: 21, bottom: 16, left: 16, background: "#402020", padding: 12 }}>
        {Array.from(cleanupErrors, ([sid, message]) => <div key={sid}>
          Terminal cleanup failed: {message} <button onClick={() => void killTerminal(sid)}>retry cleanup</button>
        </div>)}
      </div>}
      {readError && <div role="alert" style={{ position: "absolute", zIndex: 20, top: 16, left: 16, background: "#402020", padding: 12 }}>
        {readError} <button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>retry read</button>
      </div>}
      {saveError && <div role="alert" style={{ position: "absolute", zIndex: 20, top: 16, left: 16, background: "#402020", padding: 12 }}>
        {saveError} <button onClick={() => setSaveAttempt((attempt) => attempt + 1)}>retry save</button>
      </div>}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onBeforeDelete={onBeforeDelete}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        minZoom={0.2}
        maxZoom={2}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        // DocumentNode keeps editor and prompt keystrokes inside its body;
        // canvas deletion requests otherwise pass through onBeforeDelete.
        deleteKeyCode={["Backspace", "Delete"]}
        nodesConnectable
        elementsSelectable
        nodeDragThreshold={4}
      >
        <Background gap={32} size={1} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
      {hydrated && nodes.length === 0 && (
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
