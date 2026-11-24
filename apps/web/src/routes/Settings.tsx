import { Link } from "react-router";
import { Connections } from "../components/Connections";
import { Button, Card } from "../components/ui";

export function SettingsPage() {
  return (
    <section className="space-y-4 pt-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Connections</h2>
        <Connections returnPath="/settings" />
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Nutrition & weight tracking</h2>
        <Card className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Daily calorie targets, DEXA BMR & reminders</p>
            <p className="text-xs text-rock">
              Configure your DEXA RMR, weight goal, snacking alert threshold, weekly weigh-in reminder, or import Renpho CSV data.
            </p>
          </div>
          <Link to="/food">
            <Button variant="secondary" className="min-h-9 shrink-0 px-3 text-xs">
              Open Food
            </Button>
          </Link>
        </Card>
      </div>
    </section>
  );
}
