"use client";

import { DemoChrome } from "@/components/DemoChrome";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoChrome>{children}</DemoChrome>;
}
