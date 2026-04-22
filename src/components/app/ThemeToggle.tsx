import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, Theme } from "@/lib/theme";

const opts: { v: Theme; label: string; Icon: any }[] = [
  { v: "system", label: "Auto", Icon: Monitor },
  { v: "light", label: "Light", Icon: Sun },
  { v: "dark", label: "Dark", Icon: Moon },
];

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex gap-1 p-1 rounded-xl bg-surface border border-border">
      {opts.map(({ v, label, Icon }) => {
        const active = theme === v;
        return (
          <button key={v} onClick={() => setTheme(v)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium pressable transition-all ${
              active ? "bg-primary text-primary-foreground shadow-glow" : "text-secondary-fg hover:text-foreground"
            }`}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        );
      })}
    </div>
  );
};