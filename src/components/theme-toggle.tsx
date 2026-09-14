import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getStoredTheme, resolveTheme, setStoredTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function applyResolvedTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(theme, prefersDark);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Read the stored preference and apply it once the component mounts on
  // the client (localStorage/matchMedia aren't available during SSR).
  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyResolvedTheme(stored);
  }, []);

  // Keep the resolved theme in sync with OS changes while set to "system".
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyResolvedTheme("system");
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  const handleSelect = (value: Theme) => {
    setTheme(value);
    setStoredTheme(value);
    applyResolvedTheme(value);
  };

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2">
          <CurrentIcon className="h-4 w-4" /> {current.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          return (
            <DropdownMenuItem key={o.value} onClick={() => handleSelect(o.value)}>
              <Icon className="h-4 w-4 mr-2" /> {o.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
