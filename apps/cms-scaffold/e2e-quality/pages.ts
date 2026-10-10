export type Ready = { kind: "role"; role: "heading"; level: 1; name?: string } | { kind: "testId"; value: string };
export interface PageCase { id: string; surface: "front" | "back" | "admin"; path: string; mockUser: string | null; ready: Ready; desktop: boolean; mobile: boolean }
// Explicit W5 §4.3 manifest; never inferred from product routes.
export const pages: readonly PageCase[] = [
  {"id": "front-selector", "surface": "front", "path": "/", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "front-login", "surface": "front", "path": "/login", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "會員登入"}, "desktop": true, "mobile": false},
  {"id": "front-album-home", "surface": "front", "path": "/album", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "相簿"}, "desktop": true, "mobile": true},
  {"id": "front-album-list", "surface": "front", "path": "/album/albums", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "全部相簿"}, "desktop": true, "mobile": false},
  {"id": "front-album-detail", "surface": "front", "path": "/album/albums/coast-light-2026", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "Coast Light 2026"}, "desktop": true, "mobile": true},
  {"id": "front-photo", "surface": "front", "path": "/album/photos/coast-sun", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "Late sun"}, "desktop": true, "mobile": false},
  {"id": "front-clinic-home", "surface": "front", "path": "/clinic", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "Cedar Pet Clinic"}, "desktop": true, "mobile": true},
  {"id": "front-vet-list", "surface": "front", "path": "/clinic/vets", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "front-vet-detail", "surface": "front", "path": "/clinic/vets/james-carter", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "James Carter"}, "desktop": true, "mobile": false},
  {"id": "front-projects-home", "surface": "front", "path": "/projects", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "front-project-detail", "surface": "front", "path": "/projects/cms-scaffold", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "CMS Scaffold"}, "desktop": true, "mobile": true},
  {"id": "front-milestone-list", "surface": "front", "path": "/projects/cms-scaffold/milestones", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "front-milestone-detail", "surface": "front", "path": "/projects/cms-scaffold/milestones/m1-specs", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "front-not-found", "surface": "front", "path": "/album/albums/secret", "mockUser": null, "ready": {"kind": "testId", "value": "not-found-public"}, "desktop": true, "mobile": false},
  {"id": "front-empty", "surface": "front", "path": "/projects?mock=empty", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "front-error", "surface": "front", "path": "/clinic/vets/james-carter?mock=error500", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1, "name": "暫時無法載入"}, "desktop": true, "mobile": false},
  {"id": "front-member-home", "surface": "front", "path": "/clinic/me", "mockUser": "seed-member-clinic", "ready": {"kind": "testId", "value": "member-home"}, "desktop": true, "mobile": true},
  {"id": "front-member-new", "surface": "front", "path": "/clinic/appointments/new", "mockUser": "seed-member-clinic", "ready": {"kind": "testId", "value": "appointment-form"}, "desktop": true, "mobile": true},
  {"id": "front-member-detail", "surface": "front", "path": "/clinic/appointments/43000000-0000-4000-8000-000000000001", "mockUser": "seed-member-clinic", "ready": {"kind": "testId", "value": "appointment-detail"}, "desktop": true, "mobile": false},
  {"id": "front-member-forbidden", "surface": "front", "path": "/clinic/appointments/43000000-0000-4000-8000-000000000001", "mockUser": "seed-member-projects", "ready": {"kind": "testId", "value": "member-forbidden"}, "desktop": true, "mobile": false},
  {"id": "front-member-empty", "surface": "front", "path": "/clinic/me?mock=empty", "mockUser": "seed-member-clinic", "ready": {"kind": "testId", "value": "member-home"}, "desktop": true, "mobile": false},
  {"id": "back-sign-in", "surface": "back", "path": "/sign-in", "mockUser": null, "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-home", "surface": "back", "path": "/", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "back-index", "surface": "back", "path": "/entries/album", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "back-new", "surface": "back", "path": "/entries/album/new", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-detail", "surface": "back", "path": "/entries/album/30000000-0000-4000-8000-000000000008", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-preview", "surface": "back", "path": "/entries/note/30000000-0000-4000-8000-000000000037/preview", "mockUser": "mock-operator-notes", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-history", "surface": "back", "path": "/entries/note/30000000-0000-4000-8000-000000000037/history", "mockUser": "mock-operator-notes", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-media", "surface": "back", "path": "/media", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "back-media-detail", "surface": "back", "path": "/media/20000000-0000-4000-8000-000000000008", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-composer", "surface": "back", "path": "/views/album.composer", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-schedule", "surface": "back", "path": "/views/clinic.schedule", "mockUser": "seed-operator-clinic", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-board", "surface": "back", "path": "/views/projects.board?project=30000000-0000-4000-8000-000000000024", "mockUser": "seed-operator-projects", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "back-forbidden", "surface": "back", "path": "/forbidden", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "back-not-found", "surface": "back", "path": "/not-found", "mockUser": "seed-operator-album", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-overview", "surface": "admin", "path": "/", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "admin-types", "surface": "admin", "path": "/types", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-type-detail", "surface": "admin", "path": "/types/owner", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-roles", "surface": "admin", "path": "/roles", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-role-detail", "surface": "admin", "path": "/roles/member", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "admin-principals", "surface": "admin", "path": "/principals", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "admin-principal-new", "surface": "admin", "path": "/principals/new", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-principal-detail", "surface": "admin", "path": "/principals/10000000-0000-4000-8000-000000000003", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-audit", "surface": "admin", "path": "/audit", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-audit-detail", "surface": "admin", "path": "/audit/70000000-0000-4000-8000-000000000007", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-media", "surface": "admin", "path": "/media", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-settings", "surface": "admin", "path": "/settings", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-audit-settings", "surface": "admin", "path": "/settings/audit", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-entry-lookup", "surface": "admin", "path": "/entries?type=album", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-entry-inspector", "surface": "admin", "path": "/entries/30000000-0000-4000-8000-000000000017", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": true},
  {"id": "admin-forbidden", "surface": "admin", "path": "/403", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
  {"id": "admin-not-found", "surface": "admin", "path": "/impersonate", "mockUser": "seed-admin", "ready": {"kind": "role", "role": "heading", "level": 1}, "desktop": true, "mobile": false},
];

export type PrepareName =
  | "frontMobileMenu" | "frontLightbox" | "backMediaPicker"
  | "backConflictDialog" | "backLeaveDialog" | "adminConfirmDialog"
  | "adminTemporaryPassword" | "adminMemberLinkDialog";
export interface StateCase {
  id: string;
  pageId: string;
  prepare: PrepareName;
  ready: Ready;
  visual: boolean;
}
export const states: readonly StateCase[] = [
  { id:"state-front-mobile-menu", pageId:"front-album-home", prepare:"frontMobileMenu", ready:{kind:"testId",value:"site-nav-sheet"}, visual:true },
  { id:"state-front-lightbox", pageId:"front-album-detail", prepare:"frontLightbox", ready:{kind:"testId",value:"lightbox"}, visual:true },
  { id:"state-back-media-picker", pageId:"back-detail", prepare:"backMediaPicker", ready:{kind:"testId",value:"media-picker"}, visual:false },
  { id:"state-back-conflict", pageId:"back-detail", prepare:"backConflictDialog", ready:{kind:"testId",value:"conflict-dialog"}, visual:false },
  { id:"state-back-leave", pageId:"back-detail", prepare:"backLeaveDialog", ready:{kind:"testId",value:"leave-dialog"}, visual:false },
  { id:"state-admin-confirm", pageId:"admin-type-detail", prepare:"adminConfirmDialog", ready:{kind:"testId",value:"confirm-dialog"}, visual:true },
  { id:"state-admin-password", pageId:"admin-principal-new", prepare:"adminTemporaryPassword", ready:{kind:"testId",value:"temp-password"}, visual:false },
  { id:"state-admin-member-link", pageId:"admin-entry-inspector", prepare:"adminMemberLinkDialog", ready:{kind:"testId",value:"member-dialog"}, visual:false }
];
if (pages.length !== 52 || new Set(pages.map(c => c.id)).size !== 52 || pages.filter(c => c.desktop).length !== 52 || pages.filter(c => c.mobile).length !== 15) throw new Error("W5 page manifest must contain 52 unique desktop and 15 mobile cases");
if (states.length !== 8 || new Set(states.map(c => c.id)).size !== 8 || states.filter(c => c.visual).length !== 3 || states.some(s => !pages.some(p => p.id === s.pageId))) throw new Error("W5 state manifest must contain 8 unique states and 3 visual states with known pages");
