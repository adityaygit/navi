import { redirect } from "next/navigation";

// Setup moved to the full-screen /welcome flow (Navi 1.5). Old links still work.
export default function OnboardingPage() {
  redirect("/welcome");
}
