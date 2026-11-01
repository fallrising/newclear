/** Preserve stable item keys; Timeline owns the existing latest/unseen policy. */
export const timelineAnchoring = {
  anchorTo: "end",
  followOnAppend: false,
} as const;
