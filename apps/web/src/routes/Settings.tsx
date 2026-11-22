import { Connections } from "../components/Connections";

export function SettingsPage() {
  return (
    <section className="space-y-4 pt-2">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Connections</h2>
        <Connections returnPath="/settings" />
      </div>
    </section>
  );
}
