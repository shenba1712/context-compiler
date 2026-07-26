"use client";

import { WorkspaceChrome } from "@/components/WorkspaceChrome";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceChrome>{children}</WorkspaceChrome>;
}
