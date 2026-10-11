"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="secondary" className="no-print" onClick={() => window.print()}>
      <Printer aria-hidden className="size-4" /> Print or save as PDF
    </Button>
  );
}
