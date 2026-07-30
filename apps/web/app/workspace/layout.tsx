import { WorkspaceChrome } from "@/components/WorkspaceChrome";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const revampEnabled = process.env.NEXT_PUBLIC_CC_WORKSPACE_REVAMP !== "0";
  return <WorkspaceChrome revampEnabled={revampEnabled}>{children}</WorkspaceChrome>;
}
