/** Where the rail (desktop) leads. The phone's tab bar has its own four (TabBar.tsx). */
import { Building2, ChartNoAxesColumnDecreasing, FlaskConical, MessageCircleQuestionMark, Sun } from "lucide-react";

export const NAV = [
  { to: "/", label: "Today", icon: Sun },
  { to: "/pipeline", label: "Pipeline", icon: ChartNoAxesColumnDecreasing },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/lab", label: "Lab", icon: FlaskConical },
  { to: "/ask", label: "Ask", icon: MessageCircleQuestionMark },
] as const;
