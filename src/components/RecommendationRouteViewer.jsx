import { useEffect, useMemo, useRef, useState } from 'react';

function splitRouteLabel(title) {
  const normalized = String(title || '').trim();
  if (!normalized) {
    return ['未命名节点'];
  }
  if (normalized.length <= 8) {
    return [normalized];
  }

  const lines = [];
  for (let index = 0; index < normalized.length && lines.length < 2; index += 8) {
    lines.push(normalized.slice(index, index + 8));
  }
  return lines;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildCandidateList(recommendation) {
  const candidates = Array.isArray(recommendation?.candidates) ? recommendation.candidates : [];
  const selected = Array.isArray(recommendation?.selected) ? recommendation.selected : [];
  const bestPath = recommendation?.bestPath?.path ? [{ path: recommendation.bestPath.path }] : [];
  const all = [...candidates, ...selected, ...bestPath];
  const deduped = [];
  const seen = new Set();

  all.forEach((candidate, index) => {
    const path = Array.isArray(candidate?.path) ? candidate.path.map((item) => String(item)) : [];
    if (!path.length) {
      return;
    }

    const key = path.join('>');
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    deduped.push({
      ...candidate,
      routeIndex: deduped.length + 1,
      id: candidate?.id ?? `candidate-${index + 1}`,
      path,
    });
  });

  return deduped;
}

function buildNodeMap(recommendation) {
  const nodes = Array.isArray(recommendation?.graph?.nodes) ? recommendation.graph.nodes : [];
  return new Map(nodes.map((node) => [String(node.id), node]));
}

function createInitialLayout(recommendation, candidate, expanded) {
  const path = Array.isArray(candidate?.path) ? candidate.path.map((item) => String(item)) : [];
  if (!path.length) {
    return null;
  }

  const nodeMap = buildNodeMap(recommendation);
  const width = expanded ? 1120 : 860;
  const height = expanded ? 500 : 360;
  const centerY = height / 2;
  const sidePadding = expanded ? 108 : 92;
  const amplitude = expanded ? 82 : (path.length >= 5 ? 58 : 44);
  const step = path.length > 1 ? (width - sidePadding * 2) / (path.length - 1) : 0;

  const nodes = path.map((nodeId, index) => {
    const source = nodeMap.get(nodeId) ?? {};
    const isStart = index === 0;
    const isEnd = index === path.length - 1;
    const direction = index % 2 === 0 ? -1 : 1;
    const y = isStart || isEnd ? centerY : centerY + direction * amplitude;
    const title = String(source.title || nodeId);

    return {
      id: `${candidate?.id || 'route'}-${nodeId}-${index}`,
      nodeId,
      title,
      lines: splitRouteLabel(title),
      summary: typeof source.summary === 'string' ? source.summary.trim() : '',
      stepLabel: String(index + 1).padStart(2, '0'),
      x: sidePadding + step * index,
      y,
      baseX: sidePadding + step * index,
      baseY: y,
      vx: 0,
      vy: 0,
      r: isStart || isEnd ? 24 : 19,
      tone: isStart ? 'start' : (isEnd ? 'end' : 'mid'),
      labelBelow: y <= centerY,
      isStart,
      isEnd,
    };
  });

  return {
    width,
    height,
    nodes,
  };
}

function buildEdges(nodes = []) {
  return nodes.slice(0, -1).map((node, index) => {
    const target = nodes[index + 1];
    const midpointX = (node.x + target.x) / 2;
    const midpointY = (node.y + target.y) / 2;
    const verticalLift = index % 2 === 0 ? -34 : 34;
    return {
      id: `${node.id}->${target.id}`,
      d: `M ${node.x} ${node.y} C ${midpointX - 32} ${midpointY + verticalLift}, ${midpointX + 32} ${midpointY + verticalLift}, ${target.x} ${target.y}`,
    };
  });
}

export function countRecommendationRoutes(recommendation) {
  return buildCandidateList(recommendation).length;
}

export default function RecommendationRouteViewer({ recommendation, expanded = false }) {
  const candidates = useMemo(() => buildCandidateList(recommendation), [recommendation]);
  const [routeIndex, setRouteIndex] = useState(0);
  const activeCandidate = candidates[((routeIndex % Math.max(candidates.length, 1)) + Math.max(candidates.length, 1)) % Math.max(candidates.length, 1)] ?? null;
  const initialLayout = useMemo(
    () => createInitialLayout(recommendation, activeCandidate, expanded),
    [activeCandidate, expanded, recommendation],
  );
  const [simNodes, setSimNodes] = useState(() => initialLayout?.nodes ?? []);
  const [selectedNodeId, setSelectedNodeId] = useState(() => initialLayout?.nodes?.[0]?.id ?? '');
  const stageRef = useRef(null);
  const frameRef = useRef(0);
  const dragRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  useEffect(() => {
    setSimNodes(initialLayout?.nodes ?? []);
    setSelectedNodeId(initialLayout?.nodes?.[0]?.id ?? '');
    setTransform({ x: 0, y: 0, k: 1 });
  }, [initialLayout]);

  function screenToWorld(clientX, clientY, nextTransform = transform) {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || !initialLayout) {
      return { x: 0, y: 0 };
    }

    const svgX = ((clientX - rect.left) / rect.width) * initialLayout.width;
    const svgY = ((clientY - rect.top) / rect.height) * initialLayout.height;
    return {
      x: (svgX - nextTransform.x) / nextTransform.k,
      y: (svgY - nextTransform.y) / nextTransform.k,
    };
  }

  useEffect(() => {
    if (!initialLayout?.nodes?.length) {
      return undefined;
    }

    let frameCount = 0;
    let activeNodes = initialLayout.nodes.map((node) => ({ ...node }));

    function tick() {
      frameCount += 1;

      for (let index = 0; index < activeNodes.length; index += 1) {
        const node = activeNodes[index];

        for (let otherIndex = index + 1; otherIndex < activeNodes.length; otherIndex += 1) {
          const other = activeNodes[otherIndex];
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const distSq = Math.max(dx * dx + dy * dy, 60);
          const dist = Math.sqrt(distSq);
          const force = 2800 / distSq;
          const pushX = (dx / dist) * force;
          const pushY = (dy / dist) * force;
          node.vx -= pushX;
          node.vy -= pushY;
          other.vx += pushX;
          other.vy += pushY;
        }
      }

      activeNodes.forEach((node, index) => {
        const nextNode = activeNodes[index + 1];
        if (!nextNode) {
          return;
        }

        const dx = nextNode.x - node.x;
        const dy = nextNode.y - node.y;
        const dist = Math.max(Math.hypot(dx, dy), 1);
        const baseDx = nextNode.baseX - node.baseX;
        const baseDy = nextNode.baseY - node.baseY;
        const desired = Math.max(Math.hypot(baseDx, baseDy), 1);
        const spring = (dist - desired) * 0.0042;
        const pullX = (dx / dist) * spring;
        const pullY = (dy / dist) * spring;

        node.vx += pullX;
        node.vy += pullY;
        nextNode.vx -= pullX;
        nextNode.vy -= pullY;
      });

      activeNodes = activeNodes.map((node, index) => {
        const dragState = dragRef.current;
        if (dragState?.type === 'node' && dragState.nodeId === node.id) {
          return {
            ...node,
            x: clamp(dragState.worldX, 56, initialLayout.width - 56),
            y: clamp(dragState.worldY, 56, initialLayout.height - 56),
            vx: 0,
            vy: 0,
          };
        }

        const springX = (node.baseX - node.x) * (expanded ? 0.026 : 0.03);
        const springY = (node.baseY - node.y) * (expanded ? 0.026 : 0.03);
        const driftX = Math.sin((frameCount + index * 11) / 26) * 0.018;
        const driftY = Math.cos((frameCount + index * 9) / 29) * 0.018;
        const vx = (node.vx + springX + driftX) * 0.9;
        const vy = (node.vy + springY + driftY) * 0.9;

        return {
          ...node,
          x: clamp(node.x + vx, 56, initialLayout.width - 56),
          y: clamp(node.y + vy, 56, initialLayout.height - 56),
          vx,
          vy,
        };
      });

      setSimNodes(activeNodes.map((node) => ({ ...node })));
      frameRef.current = window.requestAnimationFrame(tick);
    }

    frameRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [expanded, initialLayout]);

  useEffect(() => {
    function handleMouseMove(event) {
      const dragState = dragRef.current;
      if (!dragState || !initialLayout) {
        return;
      }

      if (dragState.type === 'pan') {
        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        const dx = ((event.clientX - dragState.startX) / rect.width) * initialLayout.width;
        const dy = ((event.clientY - dragState.startY) / rect.height) * initialLayout.height;
        setTransform((current) => ({
          ...current,
          x: dragState.originX + dx,
          y: dragState.originY + dy,
        }));
        return;
      }

      const nextWorld = screenToWorld(event.clientX, event.clientY);
      dragState.worldX = nextWorld.x;
      dragState.worldY = nextWorld.y;
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
  }, [initialLayout, transform]);

  const selectedNode = simNodes.find((node) => node.id === selectedNodeId) ?? simNodes[0] ?? null;
  const edges = useMemo(() => buildEdges(simNodes), [simNodes]);

  if (!candidates.length || !initialLayout) {
    return (
      <div className="student-data-refusal">
        <p>暂无数据</p>
      </div>
    );
  }

  return (
    <div className={['student-route-panel', expanded ? 'is-expanded' : ''].join(' ')}>
      <div className={['student-route-graph-card', expanded ? 'is-expanded' : ''].join(' ')}>
        <div
          ref={stageRef}
          className="student-route-graph"
          onMouseDown={(event) => {
            event.preventDefault();
            if (!initialLayout) {
              return;
            }
            dragRef.current = null;
          }}
          onWheel={(event) => {
            if (!initialLayout) {
              return;
            }
            event.preventDefault();
            const rect = stageRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            const svgX = ((event.clientX - rect.left) / rect.width) * initialLayout.width;
            const svgY = ((event.clientY - rect.top) / rect.height) * initialLayout.height;
            const nextScale = clamp(transform.k * (event.deltaY > 0 ? 0.92 : 1.08), 0.72, 2.2);
            const worldX = (svgX - transform.x) / transform.k;
            const worldY = (svgY - transform.y) / transform.k;
            setTransform({
              k: nextScale,
              x: svgX - worldX * nextScale,
              y: svgY - worldY * nextScale,
            });
          }}
        >
          <svg
            className="student-route-svg is-draggable"
            viewBox={`0 0 ${initialLayout.width} ${initialLayout.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="推荐学习路径图"
            onMouseDown={(event) => {
              event.preventDefault();
              if (!initialLayout) {
                return;
              }
              if (event.target.closest?.('.student-route-node')) {
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
          >
            <defs>
              <filter id="studentRouteGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
              {edges.map((edge) => (
                <path key={edge.id} className="student-route-svg-line" d={edge.d} />
              ))}
              {simNodes.map((node) => (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={['student-route-node', selectedNodeId === node.id ? 'is-selected' : ''].join(' ')}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    dragRef.current = {
                      type: 'node',
                      nodeId: node.id,
                      worldX: node.x,
                      worldY: node.y,
                    };
                    setSelectedNodeId(node.id);
                  }}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <circle
                    className={`student-route-svg-halo tone-${node.tone}`}
                    r={node.r * 1.95}
                    filter="url(#studentRouteGlow)"
                  />
                  <circle className={`student-route-svg-node tone-${node.tone}`} r={node.r} />
                  <text className="student-route-svg-step" textAnchor="middle" y="4">
                    {node.stepLabel}
                  </text>
                  <text
                    className="student-route-svg-label"
                    textAnchor="middle"
                    y={node.labelBelow ? node.r + 28 : -node.r - 34}
                  >
                    {node.lines.map((line, index) => (
                      <tspan key={`${node.id}-${line}`} x="0" dy={index === 0 ? 0 : 14}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>

      {expanded && selectedNode ? (
        <div className="student-route-inspector">
          <div className="student-route-inspector-topline">
            <span className="student-route-inspector-kicker">
              {selectedNode.isStart ? '起点节点' : (selectedNode.isEnd ? '终点节点' : '路径节点')}
            </span>
            <span className="student-route-inspector-pill">{`第 ${selectedNode.stepLabel} 步`}</span>
          </div>
          <h3>{selectedNode.title}</h3>
          {selectedNode.summary ? (
            <p>{selectedNode.summary}</p>
          ) : null}
        </div>
      ) : null}

      <div className={['student-route-footer', expanded ? 'is-expanded' : ''].join(' ')}>
        <button
          type="button"
          className="student-route-switch"
          onClick={() => setRouteIndex((current) => (current - 1 + candidates.length) % candidates.length)}
          aria-label="上一条路线"
        >
          {'<'}
        </button>
        <span className="student-route-indicator">{`路线 ${activeCandidate.routeIndex} / ${candidates.length}`}</span>
        <button
          type="button"
          className="student-route-switch"
          onClick={() => setRouteIndex((current) => (current + 1) % candidates.length)}
          aria-label="下一条路线"
        >
          {'>'}
        </button>
      </div>
    </div>
  );
}
