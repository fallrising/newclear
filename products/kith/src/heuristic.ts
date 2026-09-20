import heuristicDoc from "../contracts/ambient-heuristic-v1.json" with { type: "json" };

export type HeuristicInput = {
  body: string;
  sender_kind: "human" | "agent";
  recent_10_has_agent: boolean;
};

type HeuristicRule = {
  id: string;
  pass: boolean;
  any_of_substrings?: string[];
  min_body_length?: number;
  phrases?: string[];
  literals?: string[];
  veto?: string[];
  recent_message_window?: number;
  any_agent_speaker?: boolean;
  sender_kind?: string;
};

const RULES = heuristicDoc.rules as HeuristicRule[];

function rule(id: string): HeuristicRule {
  const found = RULES.find((item) => item.id === id);
  if (!found) throw new Error(`missing heuristic rule ${id}`);
  return found;
}

/** Table-driven H1–H5. Alarm path only; never called from notify(). */
export function evaluateHeuristic(input: HeuristicInput): boolean {
  const h5 = rule("H5");
  if (input.sender_kind === h5.sender_kind) return false;

  const h4 = rule("H4");
  if (input.recent_10_has_agent && h4.any_agent_speaker) return false;

  const h1 = rule("H1");
  const h1ok =
    input.body.length >= (h1.min_body_length ?? 0) &&
    (h1.any_of_substrings ?? []).some((s) => input.body.includes(s));

  const h2 = rule("H2");
  const h2ok = (h2.phrases ?? []).some((p) => input.body.includes(p));

  const h3 = rule("H3");
  const h3ok = (h3.literals ?? []).some((l) => input.body.includes(l));

  return h1ok || h2ok || h3ok;
}
