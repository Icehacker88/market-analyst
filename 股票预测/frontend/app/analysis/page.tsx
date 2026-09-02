import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";

export default function AnalysisPage() {
  return <Suspense fallback={<main className="page-shell" />}><Dashboard /></Suspense>;
}
