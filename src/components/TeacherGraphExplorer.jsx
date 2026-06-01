import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GROUP_LABELS = {
  anchor: '当前主题',
  focus: '命中实体',
  context: '关联实体',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildModel(snapshot, graphName, query) {
  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes.filter((node) => node && typeof node === 'object') : [];
  const rawEdges = Array.isArray(snapshot?.edges) ? snapshot.edges.filter((edge) => edge && typeof edge === 'object') : [];
  const anchorId = `query:${String(query || graphName || 'graph')}`;
  const anchorTitle = String(query || graphName || '当前主题');

  const nodes = [{
    id: anchorId,
    title: anchorTitle,
    summary: graphName ? `当前图谱：${graphName}` : '当前主题图谱锚点',
    group: 'anchor',
    score: 1,
    degree: 0,
    isAnchor: true,
  }];

  rawNodes.forEach((node, index) => {
    nodes.push({
      id: String(node.id || `node-${index + 1}`),
      title: String(node.title || '未命名实体'),
      summary: String(node.summary || ''),
      group: node.group === 'focus' ? 'focus' : 'context',
      score: clamp(Number(node.score ?? 0.58), 0.18, 1),
      degree: 0,
      isAnchor: false,
    });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = [];
  const seen = new Set();

  rawEdges.forEach((edge, index) => {
    const source = String(edge.source || '');
    const target = String(edge.target || '');
    if (!source || !target || !nodeMap.has(source) || !nodeMap.has(target)) {
      return;
    }
    const key = `${source}->${target}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push({
      id: String(edge.id || `edge-${index + 1}`),
      source,
      target,
      label: String(edge.label || ''),
      type: 'graph_link',
    });
  });

  const focusNodes = nodes.filter((node) => !node.isAnchor && node.group === 'focus');
  const anchorTargets = focusNodes.length ? focusNodes : nodes.filter((node) => !node.isAnchor).slice(0, 3);

  anchorTargets.forEach((node) => {
    const key = `${anchorId}->${node.id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push({
      id: `anchor-${node.id}`,
      source: anchorId,
      target: node.id,
      label: '',
      type: 'anchor_link',
    });
  });

  edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source) {
      source.degree += 1;
    }
    if (target) {
      target.degree += 1;
    }
  });

  return {
    nodes,
    edges,
  };
}

function createInitialNodes(model, width, height) {
  const outerRadius = Math.max(150, Math.min(width, height) * 0.22);
  const graphNodes = model.nodes.filter((node) => !node.isAnchor);
  const total = graphNodes.length || 1;

  return model.nodes.map((node) => {
    if (node.isAnchor) {
      return {
        ...node,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        radius: 30,
      };
    }

    const index = graphNodes.findIndex((item) => item.id === node.id);
    const angle = (Math.PI * 2 * index) / total;
    const ring = outerRadius + ((index % 3) * 48);
    const radius = 14 + Math.min(10, node.degree * 1.8) + node.score * 6 + (node.group === 'focus' ? 4 : 0);

    return {
      ...node,
      x: Math.cos(angle) * ring,
      y: Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      radius,
    };
  });
}

function buildAdjacency(edges) {
  const map = new Map();
  edges.forEach((edge) => {
    if (!map.has(edge.source)) {
      map.set(edge.source, new Set());
    }
    if (!map.has(edge.target)) {
      map.set(edge.target, new Set());
    }
    map.get(edge.source).add(edge.target);
    map.get(edge.target).add(edge.source);
  });
  return map;
}

function buildCurvedPath(source, target) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy) || 1;
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const curve = clamp(distance * 0.16, 16, 42);
  const controlX = (source.x + target.x) / 2 + normalX * curve;
  const controlY = (source.y + target.y) / 2 + normalY * curve;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function splitTitle(title) {
  const text = String(title || '').trim();
  if (text.length <= 12) {
    return [text];
  }
  return [text.slice(0, 12), `${text.slice(12, 22)}${text.length > 22 ? '…' : ''}`];
}

export default function TeacherGraphExplorer({
  snapshot,
  graphName,
  query,
  paragraphs = [],
  className = '',
  height = 620,
}) {
  const stageRef = useRef(null);
  const frameRef = useRef(0);
  const dragRef = useRef(null);
  const [layout, setLayout] = useState({ width: 1200, height });
  const [transform, setTransform] = useState({ x: 600, y: height / 2, k: 1 });
  const [simNodes, setSimNodes] = useState([]);
  const [hoveredNodeId, setHoveredNodeId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');

  const model = useMemo(() => buildModel(snapshot, graphName, query), [snapshot, graphName, query]);
  const adjacency = useMemo(() => buildAdjacency(model.edges), [model.edges]);

  const screenToWorld = useCallback((clientX, clientY, nextTransform = transform) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return { x: 0, y: 0 };
    }
    return {
      x: (clientX - rect.left - nextTransform.x) / nextTransform.k,
      y: (clientY - rect.top - nextTransform.y) / nextTransform.k,
    };
  }, [transform]);

  useEffect(() => {
    function updateSize() {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      setLayout({ width: rect.width, height: rect.height });
      setTransform((current) => ({
        ...current,
        x: rect.width / 2,
        y: rect.height / 2,
      }));
    }

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  useEffect(() => {
    const preparedNodes = createInitialNodes(model, layout.width, layout.height);
    if (!preparedNodes.length) {
      return undefined;
    }

    let frameCount = 0;
    let didBootstrapSelection = false;
    let activeNodes = preparedNodes.map((node) => ({ ...node }));
    const anchorNode = activeNodes.find((node) => node.isAnchor);
    const edgePairs = model.edges.map((edge) => ({
      ...edge,
      sourceNode: () => activeNodes.find((node) => node.id === edge.source),
      targetNode: () => activeNodes.find((node) => node.id === edge.target),
    }));

    function tick() {
      frameCount += 1;

      for (let i = 0; i < activeNodes.length; i += 1) {
        const node = activeNodes[i];
        if (node.isAnchor) {
          node.x = 0;
          node.y = 0;
          node.vx = 0;
          node.vy = 0;
          continue;
        }

        for (let j = i + 1; j < activeNodes.length; j += 1) {
          const other = activeNodes[j];
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distSq = Math.max(dx * dx + dy * dy, 34);
          const dist = Math.sqrt(distSq);
          const force = 3800 / distSq;
          const pushX = (dx / dist) * force;
          const pushY = (dy / dist) * force;
          node.vx -= pushX;
          node.vy -= pushY;
          if (!other.isAnchor) {
            other.vx += pushX;
            other.vy += pushY;
          }
        }
      }

      edgePairs.forEach((edge) => {
        const source = edge.sourceNode();
        const target = edge.targetNode();
        if (!source || !target) {
          return;
        }

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const desired = edge.type === 'anchor_link' ? 176 : 144;
        const spring = (dist - desired) * 0.0039;
        const pullX = (dx / dist) * spring;
        const pullY = (dy / dist) * spring;

        if (!source.isAnchor) {
          source.vx += pullX;
          source.vy += pullY;
        }
        if (!target.isAnchor) {
          target.vx -= pullX;
          target.vy -= pullY;
        }
      });

      activeNodes.forEach((node, index) => {
        if (node.isAnchor) {
          return;
        }

        const dragState = dragRef.current;
        if (dragState?.type === 'node' && dragState.nodeId === node.id) {
          node.x = dragState.worldX;
          node.y = dragState.worldY;
          node.vx = 0;
          node.vy = 0;
          return;
        }

        const distanceToCenter = Math.hypot(node.x, node.y) || 1;
        node.vx += (-node.x / distanceToCenter) * 0.018;
        node.vy += (-node.y / distanceToCenter) * 0.018;
        node.vx += Math.sin((frameCount + index * 9) / 26) * 0.01;
        node.vy += Math.cos((frameCount + index * 7) / 29) * 0.01;
        node.vx *= 0.944;
        node.vy *= 0.944;
        node.x += node.vx;
        node.y += node.vy;
      });

      if (anchorNode) {
        anchorNode.x = 0;
        anchorNode.y = 0;
      }

      if (!didBootstrapSelection) {
        didBootstrapSelection = true;
        setSelectedNodeId(activeNodes[0]?.id || '');
      }

      setSimNodes(activeNodes.map((node) => ({ ...node })));
      frameRef.current = window.requestAnimationFrame(tick);
    }

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [model, layout.height, layout.width]);

  useEffect(() => {
    function handleMouseMove(event) {
      const dragState = dragRef.current;
      if (!dragState) {
        return;
      }

      if (dragState.type === 'pan') {
        setTransform((current) => ({
          ...current,
          x: dragState.originX + (event.clientX - dragState.startX),
          y: dragState.originY + (event.clientY - dragState.startY),
        }));
        return;
      }

      if (dragState.type === 'node') {
        const world = screenToWorld(event.clientX, event.clientY);
        dragState.worldX = world.x;
        dragState.worldY = world.y;
      }
    }

    function handleMouseUp() {
      dragRef.current = null;
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [screenToWorld]);

  const resolvedSelectedNodeId = simNodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : (simNodes[0]?.id || '');
  const activeNodeId = hoveredNodeId || resolvedSelectedNodeId;
  const highlightedNeighbors = useMemo(() => {
    if (!activeNodeId) {
      return new Set();
    }
    return adjacency.get(activeNodeId) ?? new Set();
  }, [activeNodeId, adjacency]);
  const selectedNode = simNodes.find((node) => node.id === resolvedSelectedNodeId) ?? simNodes[0] ?? null;

  return (
    <div className={['teacher-graph-shell', className].filter(Boolean).join(' ')}>
      <div
        ref={stageRef}
        className="teacher-graph-stage"
        style={{ minHeight: `${height}px` }}
        onMouseDown={(event) => {
          if (event.target.closest?.('.teacher-graph-inspector, .teacher-graph-legend')) {
            return;
          }
          dragRef.current = {
            type: 'pan',
            startX: event.clientX,
            startY: event.clientY,
            originX: transform.x,
            originY: transform.y,
          };
        }}
        onWheel={(event) => {
          event.preventDefault();
          const rect = stageRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          const pointerX = event.clientX - rect.left;
          const pointerY = event.clientY - rect.top;
          const nextScale = clamp(transform.k * (event.deltaY > 0 ? 0.92 : 1.08), 0.42, 2.8);
          const worldX = (pointerX - transform.x) / transform.k;
          const worldY = (pointerY - transform.y) / transform.k;

          setTransform({
            k: nextScale,
            x: pointerX - worldX * nextScale,
            y: pointerY - worldY * nextScale,
          });
        }}
      >
        <svg className="teacher-graph-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none">
          <defs>
            <filter id="teacherGraphGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient id="teacherGraphEdgeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(145, 232, 211, 0.74)" />
              <stop offset="100%" stopColor="rgba(221, 190, 122, 0.74)" />
            </linearGradient>
          </defs>

          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {model.edges.map((edge) => {
              const source = simNodes.find((node) => node.id === edge.source);
              const target = simNodes.find((node) => node.id === edge.target);
              if (!source || !target) {
                return null;
              }
              const isHighlighted = activeNodeId
                ? edge.source === activeNodeId || edge.target === activeNodeId
                  || (highlightedNeighbors.has(edge.source) && edge.target === activeNodeId)
                  || (highlightedNeighbors.has(edge.target) && edge.source === activeNodeId)
                : false;
              const isDimmed = activeNodeId && !isHighlighted;

              return (
                <path
                  key={edge.id}
                  d={buildCurvedPath(source, target)}
                  className={[
                    'teacher-graph-edge',
                    edge.type === 'anchor_link' ? 'is-anchor-edge' : '',
                    isHighlighted ? 'is-highlighted' : '',
                    isDimmed ? 'is-dimmed' : '',
                  ].filter(Boolean).join(' ')}
                />
              );
            })}

            {simNodes.map((node) => {
              const isActive = activeNodeId === node.id || highlightedNeighbors.has(node.id);
              const isDimmed = activeNodeId && !isActive;
              const titleLines = splitTitle(node.title);

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={[
                    'teacher-graph-node',
                    `group-${node.group}`,
                    isActive ? 'is-active' : '',
                    isDimmed ? 'is-dimmed' : '',
                    selectedNodeId === node.id ? 'is-selected' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onMouseLeave={() => setHoveredNodeId('')}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    const world = screenToWorld(event.clientX, event.clientY);
                    dragRef.current = {
                      type: 'node',
                      nodeId: node.id,
                      worldX: world.x,
                      worldY: world.y,
                    };
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedNodeId(node.id);
                  }}
                >
                  <circle className="teacher-graph-node-halo" r={node.radius * 1.92} filter="url(#teacherGraphGlow)" />
                  <circle className="teacher-graph-node-core" r={node.radius} />
                  <text className="teacher-graph-node-title" textAnchor="middle" y={-node.radius - 16}>
                    {titleLines.map((line, index) => (
                      <tspan key={`${node.id}-${index + 1}`} x="0" dy={index === 0 ? 0 : 18}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  <text className="teacher-graph-node-score" textAnchor="middle" y={node.radius + 22}>
                    {node.isAnchor ? '主题锚点' : `${Math.round(node.score * 100)}%`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="teacher-graph-hint">拖拽节点 · 滚轮缩放 · 拖动画布</div>

        <div className="teacher-graph-legend">
          {Object.entries(GROUP_LABELS).map(([key, label]) => (
            <div key={key} className="teacher-graph-legend-row">
              <span className={`teacher-graph-legend-dot group-${key}`} />
              {label}
            </div>
          ))}
        </div>

        {selectedNode ? (
          <aside className="teacher-graph-inspector">
            <span className="teacher-graph-inspector-kicker">
              {selectedNode.isAnchor ? '当前主题' : selectedNode.group === 'focus' ? '命中实体' : '关联实体'}
            </span>
            <h3>{selectedNode.title}</h3>
            <p>{selectedNode.summary || '当前节点暂无附加摘要。'}</p>
            <div className="teacher-graph-inspector-metrics">
              <div>
                <span>关联数</span>
                <strong>{selectedNode.degree}</strong>
              </div>
              <div>
                <span>图谱名</span>
                <strong>{graphName || '未绑定'}</strong>
              </div>
              <div>
                <span>相关度</span>
                <strong>{selectedNode.isAnchor ? '100%' : `${Math.round(selectedNode.score * 100)}%`}</strong>
              </div>
            </div>
            {selectedNode.isAnchor && paragraphs.length ? (
              <div className="teacher-graph-inspector-notes">
                {paragraphs.slice(0, 3).map((paragraph, index) => (
                  <p key={`${index + 1}-${paragraph.slice(0, 16)}`}>{paragraph}</p>
                ))}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
