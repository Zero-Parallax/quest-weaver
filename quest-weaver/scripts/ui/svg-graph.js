/**
 * Quest Weaver: the graph canvas.
 *
 * A small pan/zoom/drag engine with no dependencies. Nodes are ordinary HTML
 * elements and edges are SVG paths, both inside a single transformed viewport:
 * that way node cards get normal CSS and theming while edges get proper curves
 * and arrowheads, and one transform keeps the two layers in step.
 *
 * The engine knows nothing about quests. It renders what it is given and
 * reports what the user did through callbacks.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** How far the canvas extends in graph units. Large enough to sprawl in. */
const CANVAS_SIZE = 12000;

/** Graph-space origin offset, so negative coordinates still land on canvas. */
const ORIGIN = CANVAS_SIZE / 2;

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;

export class SvgGraph {
  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(id: string, x: number, y: number) => void} [callbacks.onNodeMove]
   * @param {(id: string|null) => void} [callbacks.onSelect]
   * @param {(id: string) => void} [callbacks.onOpen]
   * @param {(from: string, to: string) => void} [callbacks.onConnect]
   * @param {(view: {zoom: number, panX: number, panY: number}) => void} [callbacks.onViewChange]
   * @param {(event: MouseEvent, id: string|null, kind: "node"|"edge"|"canvas") => void} [callbacks.onContext]
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.nodes = [];
    this.edges = [];
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.snap = 0;
    this.selected = null;

    this.#build();
    this.#bind();
  }

  /* -------------------------------------------- */
  /*  Construction                                */
  /* -------------------------------------------- */

  #build() {
    this.container.classList.add("qw-web-canvas");
    this.container.innerHTML = "";

    this.viewport = document.createElement("div");
    this.viewport.className = "qw-web-viewport";

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "qw-web-edges");
    this.svg.setAttribute("width", CANVAS_SIZE);
    this.svg.setAttribute("height", CANVAS_SIZE);
    this.svg.append(this.#defs());

    this.edgeLayer = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.edgeLayer);

    this.nodeLayer = document.createElement("div");
    this.nodeLayer.className = "qw-web-nodes";

    this.viewport.append(this.svg, this.nodeLayer);
    this.container.append(this.viewport);
  }

  /** Arrowheads, one per colour we use, since markers cannot inherit stroke. */
  #defs() {
    const defs = document.createElementNS(SVG_NS, "defs");
    const marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "qw-arrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    path.setAttribute("fill", "context-stroke");
    marker.append(path);
    defs.append(marker);
    return defs;
  }

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  /**
   * Replace the graph contents.
   *
   * @param {object[]} nodes  {id, x, y, html, classes, color}
   * @param {object[]} edges  {id, from, to, color, dashed, label, readOnly}
   */
  setData(nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
    this.#renderNodes();
    this.#renderEdges();
  }

  setView({ zoom, panX, panY } = {}) {
    if (Number.isFinite(zoom)) this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (Number.isFinite(panX)) this.panX = panX;
    if (Number.isFinite(panY)) this.panY = panY;
    this.#applyTransform();
  }

  setSnap(size) {
    this.snap = Number(size) || 0;
  }

  /** Centre the view on the content, choosing a zoom that fits it. */
  fit(padding = 80) {
    if (!this.nodes.length) return;
    const boxes = this.nodes.map((n) => {
      const el = this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(n.id)}"]`);
      return { x: n.x, y: n.y, w: el?.offsetWidth ?? 180, h: el?.offsetHeight ?? 80 };
    });
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.w));
    const maxY = Math.max(...boxes.map((b) => b.y + b.h));

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(cw / (maxX - minX + padding), ch / (maxY - minY + padding))),
    );
    this.zoom = zoom;
    this.panX = cw / 2 - ((minX + maxX) / 2 + ORIGIN) * zoom;
    this.panY = ch / 2 - ((minY + maxY) / 2 + ORIGIN) * zoom;
    this.#applyTransform();
    this.callbacks.onViewChange?.(this.view);
  }

  get view() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  #applyTransform() {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  #renderNodes() {
    this.nodeLayer.innerHTML = "";
    for (const node of this.nodes) {
      const el = document.createElement("div");
      el.className = `qw-web-node ${node.classes ?? ""}`;
      el.dataset.nodeId = node.id;
      el.style.left = `${node.x + ORIGIN}px`;
      el.style.top = `${node.y + ORIGIN}px`;
      if (node.color) el.style.setProperty("--qw-node", node.color);
      if (node.id === this.selected) el.classList.add("is-selected");
      el.innerHTML = node.html;

      // A dedicated handle keeps "drag the card" and "draw a link" apart.
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "qw-web-handle";
      handle.title = game.i18n.localize("QW.Web.DragToLink");
      handle.innerHTML = '<i class="fa-solid fa-link"></i>';
      el.append(handle);

      this.nodeLayer.append(el);
    }
  }

  #renderEdges() {
    this.edgeLayer.innerHTML = "";
    const byId = new Map(this.nodes.map((n) => [n.id, n]));

    for (const edge of this.edges) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue; // An edge to a node that is not on this web.

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", this.#curve(a, b));
      path.setAttribute("class", `qw-web-edge ${edge.readOnly ? "is-derived" : ""}`);
      path.setAttribute("stroke", edge.color || "var(--qw-edge)");
      path.setAttribute("marker-end", "url(#qw-arrow)");
      if (edge.dashed) path.setAttribute("stroke-dasharray", "7 5");
      path.dataset.edgeId = edge.id;
      this.edgeLayer.append(path);

      if (edge.label) {
        const mid = this.#midpoint(a, b);
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", mid.x);
        text.setAttribute("y", mid.y - 6);
        text.setAttribute("class", "qw-web-edge-label");
        text.setAttribute("text-anchor", "middle");
        text.textContent = edge.label;
        this.edgeLayer.append(text);
      }
    }
  }

  /** Anchor points on the facing sides of two cards. */
  #anchors(a, b) {
    const ae = this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(a.id)}"]`);
    const be = this.nodeLayer.querySelector(`[data-node-id="${CSS.escape(b.id)}"]`);
    const aw = ae?.offsetWidth ?? 180;
    const ah = ae?.offsetHeight ?? 80;
    const bw = be?.offsetWidth ?? 180;
    const bh = be?.offsetHeight ?? 80;

    const ax = a.x + ORIGIN;
    const ay = a.y + ORIGIN + ah / 2;
    const bx = b.x + ORIGIN;
    const by = b.y + ORIGIN + bh / 2;

    // Leave from the right of the earlier card and arrive at the left of the later one.
    const leftToRight = ax + aw / 2 <= bx + bw / 2;
    return {
      x1: leftToRight ? ax + aw : ax,
      y1: ay,
      x2: leftToRight ? bx : bx + bw,
      y2: by,
      leftToRight,
    };
  }

  #curve(a, b) {
    const { x1, y1, x2, y2, leftToRight } = this.#anchors(a, b);
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    const c1 = leftToRight ? x1 + dx : x1 - dx;
    const c2 = leftToRight ? x2 - dx : x2 + dx;
    return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
  }

  #midpoint(a, b) {
    const { x1, y1, x2, y2 } = this.#anchors(a, b);
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }

  /** Redraw only the edges, for use while a node is being dragged. */
  refreshEdges() {
    this.#renderEdges();
  }

  /* -------------------------------------------- */
  /*  Interaction                                 */
  /* -------------------------------------------- */

  #bind() {
    this.container.addEventListener("wheel", this.#onWheel.bind(this), { passive: false });
    this.container.addEventListener("pointerdown", this.#onPointerDown.bind(this));
    this.container.addEventListener("dblclick", this.#onDoubleClick.bind(this));
    this.container.addEventListener("contextmenu", this.#onContextMenu.bind(this));
  }

  /** Zoom toward the cursor, not the centre, which is what feels right. */
  #onWheel(event) {
    event.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, this.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)),
    );
    const ratio = next / this.zoom;
    this.panX = mx - (mx - this.panX) * ratio;
    this.panY = my - (my - this.panY) * ratio;
    this.zoom = next;
    this.#applyTransform();
    this.callbacks.onViewChange?.(this.view);
  }

  #onPointerDown(event) {
    if (event.button === 2) return; // Right-click is handled as a context menu.

    const handle = event.target.closest(".qw-web-handle");
    if (handle) return this.#startLink(event, handle.closest("[data-node-id]"));

    const nodeEl = event.target.closest("[data-node-id]");
    if (nodeEl && event.button === 0) return this.#startNodeDrag(event, nodeEl);

    this.#select(null);
    this.#startPan(event);
  }

  #startPan(event) {
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = this.panX;
    const originY = this.panY;
    this.container.classList.add("is-panning");

    const move = (e) => {
      this.panX = originX + (e.clientX - startX);
      this.panY = originY + (e.clientY - startY);
      this.#applyTransform();
    };
    const up = () => {
      this.container.classList.remove("is-panning");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.callbacks.onViewChange?.(this.view);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  #startNodeDrag(event, nodeEl) {
    event.preventDefault();
    const id = nodeEl.dataset.nodeId;
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;

    this.#select(id);
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = node.x;
    const originY = node.y;
    let moved = false;

    const move = (e) => {
      moved = true;
      let nx = originX + (e.clientX - startX) / this.zoom;
      let ny = originY + (e.clientY - startY) / this.zoom;
      if (this.snap) {
        nx = Math.round(nx / this.snap) * this.snap;
        ny = Math.round(ny / this.snap) * this.snap;
      }
      node.x = nx;
      node.y = ny;
      nodeEl.style.left = `${nx + ORIGIN}px`;
      nodeEl.style.top = `${ny + ORIGIN}px`;
      this.refreshEdges();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) this.callbacks.onNodeMove?.(id, node.x, node.y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag from a node's link handle to another node to connect them. */
  #startLink(event, fromEl) {
    event.preventDefault();
    event.stopPropagation();
    const fromId = fromEl.dataset.nodeId;

    const ghost = document.createElementNS(SVG_NS, "path");
    ghost.setAttribute("class", "qw-web-edge is-ghost");
    ghost.setAttribute("marker-end", "url(#qw-arrow)");
    this.edgeLayer.append(ghost);

    const rect = this.container.getBoundingClientRect();
    const toGraph = (e) => ({
      x: (e.clientX - rect.left - this.panX) / this.zoom,
      y: (e.clientY - rect.top - this.panY) / this.zoom,
    });
    const from = this.nodes.find((n) => n.id === fromId);
    const fw = fromEl.offsetWidth;
    const fh = fromEl.offsetHeight;

    const move = (e) => {
      const p = toGraph(e);
      ghost.setAttribute(
        "d",
        `M ${from.x + ORIGIN + fw} ${from.y + ORIGIN + fh / 2} L ${p.x} ${p.y}`,
      );
      for (const el of this.nodeLayer.querySelectorAll(".is-link-target")) {
        el.classList.remove("is-link-target");
      }
      document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-node-id]")
        ?.classList.add("is-link-target");
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ghost.remove();
      for (const el of this.nodeLayer.querySelectorAll(".is-link-target")) {
        el.classList.remove("is-link-target");
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]");
      const toId = target?.dataset.nodeId;
      if (toId && toId !== fromId) this.callbacks.onConnect?.(fromId, toId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  #onDoubleClick(event) {
    const nodeEl = event.target.closest("[data-node-id]");
    if (nodeEl) this.callbacks.onOpen?.(nodeEl.dataset.nodeId);
  }

  #onContextMenu(event) {
    event.preventDefault();
    const nodeEl = event.target.closest("[data-node-id]");
    if (nodeEl) {
      this.#select(nodeEl.dataset.nodeId);
      return this.callbacks.onContext?.(event, nodeEl.dataset.nodeId, "node");
    }
    const edge = event.target.closest("[data-edge-id]");
    if (edge) return this.callbacks.onContext?.(event, edge.dataset.edgeId, "edge");
    this.callbacks.onContext?.(event, null, "canvas");
  }

  #select(id) {
    this.selected = id;
    for (const el of this.nodeLayer.querySelectorAll(".qw-web-node")) {
      el.classList.toggle("is-selected", el.dataset.nodeId === id);
    }
    this.callbacks.onSelect?.(id);
  }

  /** Graph coordinates at the centre of the current view, for placing new nodes. */
  centreOfView() {
    return {
      x: (this.container.clientWidth / 2 - this.panX) / this.zoom - ORIGIN,
      y: (this.container.clientHeight / 2 - this.panY) / this.zoom - ORIGIN,
    };
  }
}

/**
 * Arrange nodes in layers by dependency depth.
 *
 * A trimmed Sugiyama: rank each node by its longest path from a root, then
 * order within each rank by the average position of what it connects to, which
 * pulls related nodes level with each other and cuts crossings. Two passes is
 * enough to look tidy without the cost of a full solver.
 */
export function layeredLayout(nodes, edges, { spacingX = 260, spacingY = 130 } = {}) {
  if (!nodes.length) return new Map();


  const all = nodes.map((n) => n.id);
  const connected = new Set();
  for (const e of edges) {
    if (all.includes(e.from) && all.includes(e.to)) {
      connected.add(e.from);
      connected.add(e.to);
    }
  }

  // Nodes with no connections would otherwise pile into one tall rank-0 column,
  // which buries the chain you actually came to look at. They get their own
  // grid, parked below the graph.
  const loose = all.filter((id) => !connected.has(id));
  const ids = all.filter((id) => connected.has(id));

  const incoming = new Map(ids.map((id) => [id, []]));
  const outgoing = new Map(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (!incoming.has(e.to) || !outgoing.has(e.from)) continue;
    incoming.get(e.to).push(e.from);
    outgoing.get(e.from).push(e.to);
  }

  // Rank by longest path from any root, guarding against cycles.
  const rank = new Map(ids.map((id) => [id, 0]));
  const visiting = new Set();
  const compute = (id) => {
    if (visiting.has(id)) return rank.get(id);
    visiting.add(id);
    let best = 0;
    for (const from of incoming.get(id)) best = Math.max(best, compute(from) + 1);
    rank.set(id, best);
    visiting.delete(id);
    return best;
  };
  for (const id of ids) compute(id);

  const layers = new Map();
  for (const id of ids) {
    const r = rank.get(id);
    if (!layers.has(r)) layers.set(r, []);
    layers.get(r).push(id);
  }

  // Barycentre ordering: pull each node level with its neighbours.
  const order = new Map(ids.map((id, i) => [id, i]));
  for (let pass = 0; pass < 2; pass++) {
    for (const [, layer] of [...layers].sort((a, b) => a[0] - b[0])) {
      const score = (id) => {
        const peers = [...incoming.get(id), ...outgoing.get(id)];
        if (!peers.length) return order.get(id);
        return peers.reduce((sum, p) => sum + (order.get(p) ?? 0), 0) / peers.length;
      };
      layer.sort((a, b) => score(a) - score(b));
      layer.forEach((id, i) => order.set(id, i));
    }
  }

  const positions = new Map();
  let lowest = 0;
  for (const [r, layer] of layers) {
    const offset = ((layer.length - 1) * spacingY) / 2;
    layer.forEach((id, i) => {
      const y = i * spacingY - offset;
      positions.set(id, { x: r * spacingX, y });
      lowest = Math.max(lowest, y);
    });
  }

  const perRow = Math.max(1, Math.ceil(Math.sqrt(loose.length)));
  const top = ids.length ? lowest + spacingY * 1.6 : 0;
  loose.forEach((id, i) => {
    positions.set(id, {
      x: (i % perRow) * spacingX,
      y: top + Math.floor(i / perRow) * spacingY,
    });
  });

  return positions;
}
