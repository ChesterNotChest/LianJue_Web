import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GROUP_LABELS = {
  root: '课程核心',
  weak: '薄弱节点',
  learning: '生长中',
  normal: '稳定掌握',
  mastered: '熟练掌握',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatMasteryLabel(label) {
  if (label === 'weak') {
    return '较薄弱';
  }
  if (label === 'learning') {
    return '学习中';
  }
  if (label === 'normal') {
    return '基本稳定';
  }
  if (label === 'mastered') {
    return '熟练掌握';
  }
  return '未标记';
}

function masteryToGroup(label, isRoot = false) {
  if (isRoot) {
    return 'root';
  }
  if (label === 'mastered') {
    return 'mastered';
  }
  if (label === 'normal') {
    return 'normal';
  }
  if (label === 'learning') {
    return 'learning';
  }
  return 'weak';
}

function buildGraphModel(bundle) {
  const tree = bundle?.tree ?? {};
  const rawNodes = Array.isArray(tree?.nodes) ? tree.nodes.filter((node) => node && typeof node === 'object') : [];
  const rawEdges = Array.isArray(tree?.edges) ? tree.edges.filter((edge) => edge && typeof edge === 'object') : [];
  const rootNodeId = tree?.virtual_root?.node_id || `${tree?.tree_id || 'study-tree'}:virtual-root`;
  const rootTitle = tree?.virtual_root?.title || tree?.subject_title || '课程知识树';

  const nodes = [{
    id: rootNodeId,
    title: rootTitle,
    summary: tree?.title || '',
    masteryLabel: 'root',
    masteryScore: 1,
    group: 'root',
    degree: 0,
    displayStage: 'root',
    isRoot: true,
    lastUpdatedAt: tree?.updated_at || 0,
  }];

  rawNodes.forEach((node) => {
    const mastery = typeof node.mastery === 'object' && node.mastery ? node.mastery : {};
    const display = typeof node.display === 'object' && node.display ? node.display : {};
    const masteryScore = Number(mastery.score);

    nodes.push({
      id: String(node.node_id),
      title: String(node.title || '未命名知识点'),
      summary: String(node.summary || ''),
      masteryLabel: String(mastery.label || 'weak'),
      masteryScore: Number.isFinite(masteryScore) ? clamp(masteryScore, 0, 1) : 0,
      group: masteryToGroup(String(mastery.label || 'weak')),
      degree: 0,
      displayStage: String(display.stage || ''),
      isRoot: false,
      lastUpdatedAt: Number(node.last_updated_at || 0),
    });
  });

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incomingTargets = new Set();
  const edges = [];

  rawEdges.forEach((edge) => {
    const source = String(edge.source || '');
    const target = String(edge.target || '');

    if (!source || !target || !nodeMap.has(source) || !nodeMap.has(target)) {
      return;
    }

    edges.push({
      id: String(edge.edge_id || `${source}->${target}`),
      source,
      target,
      type: String(edge.edge_type || 'parent_of'),
    });
    incomingTargets.add(target);
  });

  rawNodes.forEach((node) => {
    const nodeId = String(node.node_id || '');
    if (!nodeId || incomingTargets.has(nodeId) || !nodeMap.has(nodeId)) {
      return;
    }
    edges.push({
      id: `${rootNodeId}->${nodeId}`,
      source: rootNodeId,
      target: nodeId,
      type: 'root_link',
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
    title: tree?.title || rootTitle,
    nodes,
    edges,
    features: bundle?.features ?? {},
  };
}

function createInitialNodes(model, width, height) {
  const centerX = 0;
  const centerY = 0;
  const outerRadius = Math.max(160, Math.min(width, height) * 0.22);
  const nonRootNodes = model.nodes.filter((node) => !node.isRoot);
  const total = nonRootNodes.length || 1;

  return model.nodes.map((node) => {
    if (node.isRoot) {
      return {
        ...node,
        x: centerX,
        y: centerY,
        vx: 0,
        vy: 0,
        radius: 26,
      };
    }

    const nonRootIndex = nonRootNodes.findIndex((item) => item.id === node.id);
    const angle = (Math.PI * 2 * nonRootIndex) / total;
    const ring = outerRadius + ((nonRootIndex % 3) * 54);
    const nodeRadius = 13 + Math.min(10, node.degree * 1.6) + (node.masteryScore * 6);

    return {
      ...node,
      x: Math.cos(angle) * ring,
      y: Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      radius: nodeRadius,
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
  const curve = clamp(distance * 0.16, 18, 46);
  const controlX = (source.x + target.x) / 2 + normalX * curve;
  const controlY = (source.y + target.y) / 2 + normalY * curve;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

export default function StudyGraphOverlay({
  open,
  bundle,
  onClose,
  inline = false,
  height = 620,
}) {
  const stageRef = useRef(null);
  const frameRef = useRef(0);
  const dragRef = useRef(null);
  const [layout, setLayout] = useState({ width: 1280, height });
  const [transform, setTransform] = useState({ x: 640, y: height / 2, k: 1 });
  const [simNodes, setSimNodes] = useState([]);
  const [hoveredNodeId, setHoveredNodeId] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const graphModel = useMemo(() => buildGraphModel(bundle), [bundle]);
  const adjacency = useMemo(() => buildAdjacency(graphModel.edges), [graphModel.edges]);
  const isVisible = inline || open;

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
    if (!isVisible || inline) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [inline, isVisible, onClose]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

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
  }, [height, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const preparedNodes = createInitialNodes(graphModel, layout.width, layout.height);

    if (!preparedNodes.length) {
      return undefined;
    }

    let frameCount = 0;
    let didBootstrapSelection = false;
    let activeNodes = preparedNodes.map((node) => ({ ...node }));
    const rootNode = activeNodes.find((node) => node.isRoot);
    const edgePairs = graphModel.edges
      .map((edge) => ({
        ...edge,
        sourceNode: () => activeNodes.find((node) => node.id === edge.source),
        targetNode: () => activeNodes.find((node) => node.id === edge.target),
      }));

    function tick() {
      frameCount += 1;

      for (let i = 0; i < activeNodes.length; i += 1) {
        const node = activeNodes[i];
        if (node.isRoot) {
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
          const distSq = Math.max(dx * dx + dy * dy, 40);
          const dist = Math.sqrt(distSq);
          const force = 4200 / distSq;
          const pushX = (dx / dist) * force;
          const pushY = (dy / dist) * force;
          node.vx -= pushX;
          node.vy -= pushY;
          if (!other.isRoot) {
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
        const desired = edge.type === 'root_link' ? 180 : 148;
        const spring = (dist - desired) * 0.0038;
        const pullX = (dx / dist) * spring;
        const pullY = (dy / dist) * spring;

        if (!source.isRoot) {
          source.vx += pullX;
          source.vy += pullY;
        }
        if (!target.isRoot) {
          target.vx -= pullX;
          target.vy -= pullY;
        }
      });

      activeNodes.forEach((node, index) => {
        if (node.isRoot) {
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
        node.vx += Math.sin((frameCount + index * 13) / 28) * 0.012;
        node.vy += Math.cos((frameCount + index * 11) / 31) * 0.012;
        node.vx *= 0.94;
        node.vy *= 0.94;
        node.x += node.vx;
        node.y += node.vy;
      });

      if (rootNode) {
        rootNode.x = 0;
        rootNode.y = 0;
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
  }, [graphModel, isVisible, layout.height, layout.width]);

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
  const features = graphModel.features ?? {};

  function handleStageMouseDown(event) {
    if (event.target.closest?.('.study-graph-inspector, .study-graph-legend, .study-graph-button')) {
      return;
    }
    dragRef.current = {
      type: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
  }

  function handleStageWheel(event) {
    event.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const nextScale = clamp(transform.k * (event.deltaY > 0 ? 0.92 : 1.08), 0.42, 2.6);
    const worldX = (pointerX - transform.x) / transform.k;
    const worldY = (pointerY - transform.y) / transform.k;

    setTransform({
      k: nextScale,
      x: pointerX - worldX * nextScale,
      y: pointerY - worldY * nextScale,
    });
  }

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

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
  }, [isVisible, screenToWorld]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={['study-graph-shell', inline ? 'is-inline' : 'is-overlay'].join(' ')}
      role={inline ? 'region' : 'dialog'}
      aria-modal={inline ? undefined : 'true'}
      aria-label="个人知识树图谱"
    >
      {!inline ? (
        <div className="study-graph-header">
          <div className="study-graph-header-copy">
            <h2>个人知识树</h2>
            <p>{graphModel.title}</p>
          </div>
          <div className="study-graph-controls">
            <button type="button" className="study-graph-button" onClick={() => setTransform({ x: layout.width / 2, y: layout.height / 2, k: 1 })}>
              复位
            </button>
            <button type="button" className="study-graph-button is-close" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={stageRef}
        className="study-graph-stage"
        style={inline ? { height: `${height}px` } : undefined}
        onMouseDown={handleStageMouseDown}
        onWheel={handleStageWheel}
      >
        {inline ? (
          <div className="study-graph-inline-controls">
            <button type="button" className="study-graph-button" onClick={() => setTransform({ x: layout.width / 2, y: layout.height / 2, k: 1 })}>
              复位
            </button>
          </div>
        ) : null}
        <svg className="study-graph-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="none">
          <defs>
            <filter id="studyGraphGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <linearGradient id="studyGraphEdgeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(145, 232, 211, 0.72)" />
              <stop offset="100%" stopColor="rgba(221, 190, 122, 0.72)" />
            </linearGradient>
          </defs>

          <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
            {graphModel.edges.map((edge) => {
              const source = simNodes.find((node) => node.id === edge.source);
              const target = simNodes.find((node) => node.id === edge.target);
              if (!source || !target) {
                return null;
              }
              const isHighlighted = activeNodeId
                ? edge.source === activeNodeId
                  || edge.target === activeNodeId
                  || (highlightedNeighbors.has(edge.source) && edge.target === activeNodeId)
                  || (highlightedNeighbors.has(edge.target) && edge.source === activeNodeId)
                : false;
              const isDimmed = activeNodeId && !isHighlighted;

              return (
                <path
                  key={edge.id}
                  d={buildCurvedPath(source, target)}
                  className={[
                    'study-graph-edge',
                    isHighlighted ? 'is-highlighted' : '',
                    isDimmed ? 'is-dimmed' : '',
                  ].filter(Boolean).join(' ')}
                />
              );
            })}

            {simNodes.map((node) => {
              const isActive = activeNodeId === node.id || highlightedNeighbors.has(node.id);
              const isDimmed = activeNodeId && !isActive;

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={[
                    'study-graph-node',
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
                  <circle className="study-graph-node-halo" r={node.radius * 1.8} filter="url(#studyGraphGlow)" />
                  <circle className="study-graph-node-core" r={node.radius} />
                  <text className="study-graph-node-title" textAnchor="middle" y={-node.radius - 12}>
                    {node.title}
                  </text>
                  <text className="study-graph-node-score" textAnchor="middle" y={node.radius + 20}>
                    {node.isRoot ? '课程根' : `${Math.round(node.masteryScore * 100)}%`}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="study-graph-hint">
          拖拽节点 · 滚轮缩放 · 拖动画布
        </div>

        <div className="study-graph-legend">
          {Object.entries(GROUP_LABELS).map(([key, label]) => (
            <div key={key} className="study-graph-legend-row">
              <span className={`study-graph-legend-dot group-${key}`} />
              {label}
            </div>
          ))}
        </div>

        {selectedNode ? (
          <aside className="study-graph-inspector">
            <span className="study-graph-inspector-kicker">
              {selectedNode.isRoot ? '课程根节点' : formatMasteryLabel(selectedNode.masteryLabel)}
            </span>
            <h3>{selectedNode.title}</h3>
            <p>{selectedNode.summary || '当前节点暂无额外摘要。'}</p>
            <div className="study-graph-inspector-metrics">
              <div>
                <span>掌握度</span>
                <strong>{selectedNode.isRoot ? '100%' : `${Math.round(selectedNode.masteryScore * 100)}%`}</strong>
              </div>
              <div>
                <span>关联数</span>
                <strong>{selectedNode.degree}</strong>
              </div>
              <div>
                <span>阶段</span>
                <strong>{selectedNode.displayStage || (selectedNode.isRoot ? 'root' : 'growing')}</strong>
              </div>
            </div>
            <div className="study-graph-inspector-summary">
              <span>{`已学习 ${features.learned_topics?.length ?? 0}`}</span>
              <span>{`薄弱 ${features.weak_topics?.length ?? 0}`}</span>
              <span>{`已掌握 ${features.mastered_topics?.length ?? 0}`}</span>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
