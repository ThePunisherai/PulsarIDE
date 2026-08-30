import { useEffect, useRef, useState } from "react";
import { createTopDockController } from "./topDockController";

export type AnimatedTopDockProps = {
  proximity?: number;
  spring?: number;
  damping?: number;
  widthGrowth?: number;
  heightGrowth?: number;
  drop?: number;
  className?: string;
};

export const ANIMATED_TOP_DOCK_DEFAULTS = {
  proximity: 122,
  spring: 0.19,
  damping: 0.7,
  widthGrowth: 17,
  heightGrowth: 16,
  drop: 3.5,
} as const;

const ITEMS = [
  { id: "system", label: "SYSTEM", icon: <><rect x="2.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="2.25" width="4.5" height="4.5" rx=".8" /><rect x="2.25" y="9.25" width="4.5" height="4.5" rx=".8" /><rect x="9.25" y="9.25" width="4.5" height="4.5" rx=".8" /></> },
  { id: "method", label: "METHOD", icon: <><circle cx="3" cy="8" r="1.5" /><circle cx="12.5" cy="3.5" r="1.5" /><circle cx="12.5" cy="12.5" r="1.5" /><path d="M4.5 7.3 11 4.2M4.5 8.7l6.5 3.1" /></> },
  { id: "work", label: "WORK", icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12M5 4.5h.01M7 4.5h.01" /></> },
  { id: "access", label: "ACCESS", icon: <><circle cx="5.2" cy="6.2" r="2.7" /><path d="m7.2 8.2 5.9 5.1M10.2 10.8l1.5-1.5M12 12.4l1.4-1.4" /></> },
  { id: "notes", label: "NOTES", icon: <><path d="M4 2.25h5.4L12 4.85v8.9H4z" /><path d="M9.25 2.25V5h2.7M6 8h4M6 10.5h4" /></> },
] as const;

export function AnimatedTopDock({ className = "", ...props }: AnimatedTopDockProps) {
  const rootRef = useRef<HTMLElement>(null);
  const optionsRef = useRef({ ...ANIMATED_TOP_DOCK_DEFAULTS, ...props });
  optionsRef.current = { ...ANIMATED_TOP_DOCK_DEFAULTS, ...props };
  const [active, setActive] = useState("system");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    return createTopDockController(root, () => optionsRef.current);
  }, []);

  return (
    <div className={`animated-top-dock-component${className ? ` ${className}` : ""}`}>
      <nav ref={rootRef} className="animated-top-dock__nav" aria-label="Animated top dock" data-dock-state="idle" data-dock-max="0.00">
        <button className="animated-top-dock__item animated-top-dock__logo" data-dock-item type="button" aria-label="Home" onClick={() => setActive("system")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="4.5" fill="#E8E8E3" /><path d="M6 6h8.6L18 9.35v8.15H9.15L6 14.35V6Z" fill="#111" /><path d="M9 9h5.15L15 9.85V15H9.85L9 14.15V9Z" fill="#E8E8E3" /><path d="M12 9v6M9 12h6" stroke="#111" strokeWidth=".7" /></svg>
        </button>
        {ITEMS.map((item) => (
          <button key={item.id} className="animated-top-dock__item animated-top-dock__link" data-dock-item type="button" aria-pressed={active === item.id} onClick={() => setActive(item.id)}>
            <span className="animated-top-dock__icon" aria-hidden="true"><svg viewBox="0 0 16 16">{item.icon}</svg></span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <p className="animated-top-dock-component__caption">MOVE ACROSS THE DOCK · FOCUS WITH TAB</p>
    </div>
  );
}
