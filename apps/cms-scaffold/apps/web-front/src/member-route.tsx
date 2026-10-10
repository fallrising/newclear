import { Outlet } from "react-router";
import { MemberGate } from "./member-auth";

export function MemberRoute() {
  return <MemberGate><Outlet /></MemberGate>;
}
