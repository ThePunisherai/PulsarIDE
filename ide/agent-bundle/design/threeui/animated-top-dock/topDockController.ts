export type TopDockOptions = {
  proximity: number;
  spring: number;
  damping: number;
  widthGrowth: number;
  heightGrowth: number;
  drop: number;
};

type DockItemState = {
  element: HTMLElement;
  baseWidth: number;
  baseHeight: number;
  value: number;
  velocity: number;
  target: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function createTopDockController(
  root: HTMLElement,
  getOptions: () => TopDockOptions,
) {
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const precisionQuery = window.matchMedia("(hover:hover) and (pointer:fine)");
  const items: DockItemState[] = Array.from(root.querySelectorAll<HTMLElement>("[data-dock-item]")).map((element) => ({
    element,
    baseWidth: 0,
    baseHeight: 0,
    value: 0,
    velocity: 0,
    target: 0,
  }));

  let enabled = false;
  let pointerActive = false;
  let dirty = false;
  let frame = 0;

  const canAnimate = () => !reducedQuery.matches && root.clientWidth > 0 && window.innerWidth > 600 && precisionQuery.matches;

  const measure = () => {
    enabled = canAnimate();
    for (const state of items) {
      state.element.style.width = "";
      state.element.style.height = "";
      state.element.style.transform = "";
      state.element.dataset.dockNear = "false";
    }
    for (const state of items) {
      const rect = state.element.getBoundingClientRect();
      state.baseWidth = rect.width;
      state.baseHeight = rect.height;
      state.value = 0;
      state.velocity = 0;
      state.target = 0;
    }
    pointerActive = false;
    dirty = false;
    root.dataset.dockState = enabled ? "idle" : "static";
    root.dataset.dockMax = "0.00";
  };

  const setTargets = (clientX: number) => {
    if (!enabled) return;
    const options = getOptions();
    const rects = items.map((state) => state.element.getBoundingClientRect());
    for (let index = 0; index < items.length; index += 1) {
      const center = rects[index].left + rects[index].width * 0.5;
      const proximity = clamp(1 - Math.abs(clientX - center) / Math.max(1, options.proximity), 0, 1);
      const influence = proximity * proximity * (3 - 2 * proximity);
      items[index].target = influence;
      items[index].element.dataset.dockNear = influence > 0.08 ? "true" : "false";
    }
    pointerActive = true;
    dirty = true;
    root.dataset.dockState = "active";
  };

  const focusItem = (item: HTMLElement) => {
    if (!enabled) return;
    const index = items.findIndex((state) => state.element === item);
    if (index < 0) return;
    items.forEach((state, itemIndex) => {
      state.target = itemIndex === index ? 1 : Math.abs(itemIndex - index) === 1 ? 0.24 : 0;
      state.element.dataset.dockNear = state.target > 0.08 ? "true" : "false";
    });
    pointerActive = false;
    dirty = true;
    root.dataset.dockState = "focus";
  };

  const reset = () => {
    pointerActive = false;
    dirty = true;
    items.forEach((state) => {
      state.target = 0;
      state.element.dataset.dockNear = "false";
    });
  };

  const draw = () => {
    if (enabled && dirty) {
      const options = getOptions();
      let moving = false;
      let maxValue = 0;
      for (const state of items) {
        state.velocity += (state.target - state.value) * options.spring;
        state.velocity *= options.damping;
        state.value += state.velocity;
        if (Math.abs(state.target - state.value) < 0.001 && Math.abs(state.velocity) < 0.001) {
          state.value = state.target;
          state.velocity = 0;
        } else {
          moving = true;
        }

        const value = clamp(state.value, 0, 1.08);
        const isLogo = state.element.classList.contains("animated-top-dock__logo");
        const extraWidth = isLogo ? options.widthGrowth * (14 / 17) : Math.min(options.widthGrowth, state.baseWidth * 0.24);
        const extraHeight = isLogo ? options.heightGrowth * (14 / 16) : options.heightGrowth;
        state.element.style.width = `${(state.baseWidth + extraWidth * value).toFixed(2)}px`;
        state.element.style.height = `${(state.baseHeight + extraHeight * value).toFixed(2)}px`;
        state.element.style.transform = `translateY(${(value * options.drop).toFixed(2)}px)`;
        maxValue = Math.max(maxValue, value);
      }
      root.dataset.dockMax = maxValue.toFixed(2);
      if (!moving) {
        dirty = false;
        if (items.every((state) => state.target === 0)) root.dataset.dockState = "idle";
      }
    }
    frame = requestAnimationFrame(draw);
  };

  const onPointerMove = (event: PointerEvent) => setTargets(event.clientX);
  const onWindowPointerMove = (event: PointerEvent) => {
    if (!pointerActive) return;
    const rootRect = root.getBoundingClientRect();
    const itemRects = items.map((state) => state.element.getBoundingClientRect());
    const bottom = Math.max(rootRect.bottom, ...itemRects.map((rect) => rect.bottom));
    const outside = event.clientX < rootRect.left || event.clientX > rootRect.right || event.clientY < rootRect.top || event.clientY > bottom;
    if (outside) reset();
  };
  const onFocusIn = (event: FocusEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-dock-item]");
    if (item) focusItem(item);
  };
  const onFocusOut = () => requestAnimationFrame(() => {
    if (!root.contains(document.activeElement)) reset();
  });
  const onKeyDown = (event: KeyboardEvent) => {
    const item = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-dock-item]");
    if (item && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      item.click();
    }
  };
  const onClick = () => reset();

  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(root.parentElement ?? root);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerleave", reset);
  root.addEventListener("focusin", onFocusIn);
  root.addEventListener("focusout", onFocusOut);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("click", onClick);
  window.addEventListener("pointermove", onWindowPointerMove, { passive: true });
  reducedQuery.addEventListener("change", measure);
  precisionQuery.addEventListener("change", measure);
  measure();
  frame = requestAnimationFrame(draw);

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerleave", reset);
    root.removeEventListener("focusin", onFocusIn);
    root.removeEventListener("focusout", onFocusOut);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("click", onClick);
    window.removeEventListener("pointermove", onWindowPointerMove);
    reducedQuery.removeEventListener("change", measure);
    precisionQuery.removeEventListener("change", measure);
  };
}
