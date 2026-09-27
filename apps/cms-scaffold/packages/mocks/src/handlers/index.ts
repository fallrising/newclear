import { adminHandlers } from "./admin";
import { authHandlers } from "./auth";
import { commonHandlers, fallbackHandlers } from "./common";
import { publicHandlers } from "./public";
import { workHandlers } from "./work";

/** Order matters: common checks first, then specific routes (quota before /media/:id), fallback last. */
export const handlers = [
  ...commonHandlers,
  ...authHandlers,
  ...publicHandlers,
  ...adminHandlers,
  ...workHandlers,
  ...fallbackHandlers,
];
