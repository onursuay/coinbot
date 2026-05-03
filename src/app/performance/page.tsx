import { redirect } from "next/navigation";

export default function PerformancePage() {
  redirect("/strategy-center?tab=performance");
}
