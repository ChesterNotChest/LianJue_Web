import { useEffect, useMemo, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import {
  Button,
  DisabledBlock,
  EmptyState,
  LoadingPlaceholder,
  MaterialShelf,
  StatusPill,
  SyllabusSwitcher,
  WeekAxis,
} from '../components/DashboardShared';
import {
  askQuestion,
  getPersonalSyllabus,
  getLearningProfile,
  getStudentDashboardData,
  initPersonalSyllabus,
} from '../api/learning_api';
import { getPersonalRecommendation } from '../api/personal_recommendation_api';
import { downloadFile } from '../api/file_transmit_api';
import { getCurrentUserId } from '../api/session';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCurrentWeekIndex(dayOneTime, periodLength) {
  if (!dayOneTime || !periodLength) {
    return null;
  }

  const dayOneDate = new Date(dayOneTime);
  if (Number.isNaN(dayOneDate.getTime())) {
    return null;
  }

  const diffMs = Date.now() - dayOneDate.getTime();
  if (diffMs < 0) {
    return 1;
  }

  const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(weekIndex, 1), periodLength);
}

const DEFAULT_PROFILE_METRICS = [
  { key: 'overall_score', label: '综合掌握' },
  { key: 'answer_score', label: '答题表现' },
  { key: 'syllabus_score', label: '大纲跟进' },
  { key: 'engagement_score', label: '学习投入' },
];

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeProfileMetricValue(rawValue) {
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  if (numericValue <= 1) {
    return clampPercent(numericValue * 100);
  }

  return clampPercent(numericValue);
}

function formatProfileMetricValue(rawValue) {
  return `${normalizeProfileMetricValue(rawValue)}%`;
}

function getMasteryTone(level) {
  const normalized = String(level ?? '').toLowerCase();

  if (normalized === 'master') {
    return 'success';
  }
  if (normalized === 'normal') {
    return 'warning';
  }
  if (normalized === 'weak') {
    return 'danger';
  }
  return 'neutral';
}

function formatMasteryLevel(level) {
  const normalized = String(level ?? '').toLowerCase();

  if (normalized === 'master') {
    return '熟练掌握';
  }
  if (normalized === 'normal') {
    return '基本掌握';
  }
  if (normalized === 'weak') {
    return '较为薄弱';
  }
  if (normalized === 'none') {
    return '尚未形成';
  }
  return '暂无';
}

function polarToCartesian(center, radius, angleDegrees) {
  const angleRadians = ((angleDegrees - 90) * Math.PI) / 180;

  return {
    x: center + radius * Math.cos(angleRadians),
    y: center + radius * Math.sin(angleRadians),
  };
}

function getPathKey(path = []) {
  return Array.isArray(path) ? path.map((item) => String(item)).join('>') : '';
}

function buildRecommendationReason(candidate, nodeMap, recommendation) {
  if (recommendation?.meta?.reason) {
    return recommendation.meta.reason;
  }

  if (!candidate || !Array.isArray(candidate.path) || !candidate.path.length) {
    return '当前还没有可用的推荐路径。';
  }

  const titles = candidate.path
    .map((nodeId) => nodeMap.get(String(nodeId))?.title ?? String(nodeId))
    .filter(Boolean);

  if (titles.length <= 3) {
    return `推荐理由：当前主题已经直接命中核心知识点，系统优先返回这条更短的关键链路：${titles.join(' -> ')}。`;
  }

  return `推荐理由：这条路径在当前候选里综合评分最高，并且满足先修关系，建议按 ${titles.join(' -> ')} 的顺序推进。`;
}

function buildRecommendationColumns(nodes = []) {
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const levelCache = new Map();

  const resolveLevel = (nodeId, stack = new Set()) => {
    if (levelCache.has(nodeId)) {
      return levelCache.get(nodeId);
    }

    if (stack.has(nodeId)) {
      return 0;
    }

    const node = nodeMap.get(nodeId);
    if (!node) {
      return 0;
    }

    stack.add(nodeId);
    const prerequisites = Array.isArray(node.prerequisites) ? node.prerequisites.map((item) => String(item)) : [];
    const level = prerequisites.length
      ? Math.max(...prerequisites.map((item) => resolveLevel(item, stack) + 1))
      : 0;
    stack.delete(nodeId);
    levelCache.set(nodeId, level);
    return level;
  };

  nodes.forEach((node) => {
    resolveLevel(String(node.id));
  });

  const grouped = new Map();
  nodes.forEach((node) => {
    const level = levelCache.get(String(node.id)) ?? 0;
    if (!grouped.has(level)) {
      grouped.set(level, []);
    }
    grouped.get(level).push(node);
  });

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([level, items]) => ({
      level,
      title: level === 0 ? '起步层' : `第 ${level + 1} 层`,
      items: [...items].sort((left, right) => String(left.title ?? '').localeCompare(String(right.title ?? ''), 'zh-Hans-CN')),
    }));
}

function buildRecommendationTreeLayout(columns = []) {
  const nodeWidth = 116;
  const nodeHeight = 116;
  const nodeCircleSize = 68;
  const columnGap = 34;
  const rowGap = 18;
  const paddingX = 14;
  const paddingY = 26;
  const positionMap = new Map();

  const maxRows = Math.max(...columns.map((column) => column.items.length), 1);
  const height = paddingY * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * rowGap;
  const width = paddingX * 2 + columns.length * nodeWidth + Math.max(0, columns.length - 1) * columnGap;

  columns.forEach((column, columnIndex) => {
    const totalColumnHeight = column.items.length * nodeHeight + Math.max(0, column.items.length - 1) * rowGap;
    const startY = paddingY + Math.max(0, (height - paddingY * 2 - totalColumnHeight) / 2);

    column.items.forEach((node, nodeIndex) => {
      const nodeId = String(node.id);
      positionMap.set(nodeId, {
        x: paddingX + columnIndex * (nodeWidth + columnGap),
        y: startY + nodeIndex * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
        column: column.level,
      });
    });
  });

  return {
    width,
    height,
    nodeWidth,
    nodeHeight,
    nodeCircleSize,
    positionMap,
  };
}

function LearningRecommendationPath({
  recommendation,
  activePathKey,
  onSelectPath,
  onRefresh,
  loading,
}) {
  const nodes = recommendation?.graph?.nodes ?? [];
  const candidates = recommendation?.candidates ?? [];
  const bestPathKey = getPathKey(recommendation?.bestPath?.path ?? candidates[0]?.path ?? []);
  const currentPathKey = activePathKey || bestPathKey;
  const activeCandidate = candidates.find((candidate) => getPathKey(candidate.path) === currentPathKey) ?? candidates[0] ?? null;
  const activePathNodeSet = new Set((activeCandidate?.path ?? []).map((item) => String(item)));
  const activePathEdgeSet = new Set((activeCandidate?.path_edges ?? []).map((edge) => edge.edge_id));
  const columns = buildRecommendationColumns(nodes);
  const treeLayout = buildRecommendationTreeLayout(columns);
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const recommendationReason = buildRecommendationReason(activeCandidate, nodeMap, recommendation);
  const activePathTitles = (activeCandidate?.path ?? [])
    .map((nodeId) => nodeMap.get(String(nodeId))?.title ?? String(nodeId))
    .filter(Boolean);

  return (
    <div className="recommendation-panel">
      <div className="recommendation-toolbar">
        <div className="recommendation-summary-strip">
          <strong>{activeCandidate?.selected ? '当前最佳路径' : '候选路径'}</strong>
          <span>{`候选 ${candidates.length} 条`}</span>
          <span>{`图节点 ${nodes.length} 个`}</span>
        </div>
        <Button variant="primary" className="button-compact" disabled={loading} onClick={onRefresh}>
          {loading ? '刷新中...' : '刷新'}
        </Button>
      </div>

      {candidates.length > 1 ? (
        <div className="recommendation-tab-row">
          {candidates.map((candidate, index) => {
            const pathKey = getPathKey(candidate.path);
            const isBest = pathKey === bestPathKey;
            const isActive = pathKey === currentPathKey;

            return (
              <button
                key={pathKey || `candidate-${index + 1}`}
                type="button"
                className={[
                  'recommendation-tab',
                  isActive ? 'is-active' : '',
                  isBest ? 'is-best' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onSelectPath(pathKey)}
              >
                <strong>{isBest ? '最佳路径' : `候选 ${index + 1}`}</strong>
                <span>{`${candidate.path?.length ?? 0} 个节点`}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {activePathTitles.length ? (
        <div className="recommendation-focus-strip" aria-label="当前推荐主路径">
          {activePathTitles.map((title, index) => (
            <div key={`${title}-${index + 1}`} className="recommendation-focus-step">
              <span className="recommendation-focus-index">{index + 1}</span>
              <strong>{title}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="recommendation-reason-card">
        <strong>推荐理由</strong>
        <p>{recommendationReason}</p>
      </div>

      {columns.length ? (
        <>
          <div className="recommendation-tree-head">
            <strong>推荐路径树</strong>
            <span>高亮节点表示当前选中的最佳学习链路。</span>
          </div>
          <div className="recommendation-tree-scroll">
            <div
              className="recommendation-tree-canvas"
              style={{ width: `${treeLayout.width}px`, height: `${treeLayout.height}px` }}
              >
                {columns.map((column) => {
                  const firstPosition = treeLayout.positionMap.get(String(column.items[0]?.id ?? ''));

                  if (!firstPosition) {
                    return null;
                  }

                  return (
                    <div
                      key={`band-${column.level}`}
                      className="recommendation-tree-band"
                      style={{
                        left: `${firstPosition.x - 10}px`,
                        top: '18px',
                        width: `${treeLayout.nodeWidth + 20}px`,
                        height: `${treeLayout.height - 36}px`,
                      }}
                    />
                  );
                })}

              <svg
                className="recommendation-tree-svg"
                viewBox={`0 0 ${treeLayout.width} ${treeLayout.height}`}
                style={{ width: `${treeLayout.width}px`, height: `${treeLayout.height}px` }}
                aria-hidden="true"
              >
                {(recommendation?.graph?.edges ?? []).map((edge) => {
                  const source = treeLayout.positionMap.get(String(edge.source));
                  const target = treeLayout.positionMap.get(String(edge.target));

                  if (!source || !target) {
                    return null;
                  }

                  const startX = source.x + source.width / 2;
                  const startY = source.y + treeLayout.nodeCircleSize / 2;
                  const endX = target.x + target.width / 2;
                  const endY = target.y + treeLayout.nodeCircleSize / 2;
                  const curve = Math.max(24, (endX - startX) / 2);
                  const pathData = [
                    `M ${startX} ${startY}`,
                    `C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`,
                  ].join(' ');

                  return (
                    <path
                      key={edge.edge_id}
                      d={pathData}
                      className={activePathEdgeSet.has(edge.edge_id) ? 'recommendation-tree-edge is-active' : 'recommendation-tree-edge'}
                    />
                  );
                })}
              </svg>

              {columns.map((column) => (
                <div
                  key={column.level}
                  className="recommendation-tree-column-label"
                  style={{
                    left: `${treeLayout.positionMap.get(String(column.items[0]?.id ?? ''))?.x ?? 0}px`,
                    top: '0px',
                    width: `${treeLayout.nodeWidth}px`,
                  }}
                >
                  <strong>{column.title}</strong>
                </div>
              ))}

              {nodes.map((node) => {
                const nodeId = String(node.id);
                const position = treeLayout.positionMap.get(nodeId);

                if (!position) {
                  return null;
                }

                const isActiveNode = activePathNodeSet.has(nodeId);
                const stepIndex = activeCandidate?.path?.findIndex((item) => String(item) === nodeId) ?? -1;
                const stepLabel = stepIndex >= 0
                  ? (stepIndex === activePathTitles.length - 1 ? '目标节点' : stepIndex === 0 ? '起点节点' : '推荐节点')
                  : '可衔接';

                return (
                  <article
                    key={nodeId}
                    className={['recommendation-tree-node', isActiveNode ? 'is-active-node' : ''].filter(Boolean).join(' ')}
                    style={{
                      left: `${position.x}px`,
                      top: `${position.y}px`,
                      width: `${position.width}px`,
                      minHeight: `${position.height}px`,
                    }}
                  >
                    <div className={['recommendation-tree-circle', isActiveNode ? 'is-active-circle' : ''].filter(Boolean).join(' ')}>
                      {isActiveNode ? <span className="recommendation-tree-step">{stepIndex + 1}</span> : <span className="recommendation-tree-dot" />}
                    </div>
                    <div className={['recommendation-tree-label', isActiveNode ? 'is-active-label' : ''].filter(Boolean).join(' ')}>
                      <span className="recommendation-tree-node-meta">{stepLabel}</span>
                      <strong className="recommendation-tree-title">{node.title}</strong>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          {activeCandidate && activeCandidate.scores?.total != null ? (
            <div className="recommendation-path-footer">
              <strong>{`当前最佳路径综合评分 ${Math.round(Number(activeCandidate.scores.total) * 100)} 分`}</strong>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState>当前没有可展示的推荐图。</EmptyState>
      )}
    </div>
  );
}

function LearningProfileRadar({ metrics }) {
  const size = 388;
  const center = size / 2;
  const radius = 114;
  const labelRadius = radius + 40;
  const levelRatios = [0.25, 0.5, 0.75, 1];
  const ringLabels = ['25', '50', '75', '100'];

  const levelPolygons = levelRatios.map((ratio) => metrics.map((_, index) => {
    const point = polarToCartesian(center, radius * ratio, (360 / metrics.length) * index);
    return `${point.x},${point.y}`;
  }).join(' '));

  const dataPolygon = metrics.map((metric, index) => {
    const point = polarToCartesian(center, radius * (metric.percent / 100), (360 / metrics.length) * index);
    return `${point.x},${point.y}`;
  }).join(' ');

  return (
    <div className="profile-radar-shell">
      <svg viewBox={`0 0 ${size} ${size}`} className="profile-radar-chart" role="img" aria-label="学生画像雷达图">
        <defs>
          <radialGradient id="profileRadarGlow" cx="50%" cy="48%" r="56%">
            <stop offset="0%" stopColor="rgba(42, 126, 103, 0.22)" />
            <stop offset="68%" stopColor="rgba(42, 126, 103, 0.08)" />
            <stop offset="100%" stopColor="rgba(42, 126, 103, 0)" />
          </radialGradient>
          <linearGradient id="profileRadarFill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(45, 139, 113, 0.36)" />
            <stop offset="100%" stopColor="rgba(217, 165, 78, 0.20)" />
          </linearGradient>
          <linearGradient id="profileRadarStroke" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1d5e4d" />
            <stop offset="100%" stopColor="#c7964d" />
          </linearGradient>
          <filter id="profileRadarShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="12" stdDeviation="12" floodColor="rgba(23, 78, 64, 0.18)" />
          </filter>
        </defs>

        <circle cx={center} cy={center} r={radius + 30} className="profile-radar-halo" />

        {levelPolygons.map((points, index) => (
          <polygon
            key={`level-${levelRatios[index]}`}
            points={points}
            className={index % 2 === 0 ? 'profile-radar-grid' : 'profile-radar-grid is-alt'}
          />
        ))}

        {levelRatios.map((ratio, index) => (
          <g key={`ring-label-${ratio}`}>
            <circle
              cx={center}
              cy={center}
              r={radius * ratio}
              className="profile-radar-ring"
            />
            <text
              x={center + 22}
              y={center - radius * ratio + 12}
              textAnchor="start"
              className="profile-radar-ring-text"
            >
              {ringLabels[index]}
            </text>
          </g>
        ))}

        {metrics.map((metric, index) => {
          const axisPoint = polarToCartesian(center, radius, (360 / metrics.length) * index);
          const labelPoint = polarToCartesian(center, labelRadius, (360 / metrics.length) * index);
          const valuePoint = polarToCartesian(center, radius * (metric.percent / 100), (360 / metrics.length) * index);
          const valueTagX = valuePoint.x + (valuePoint.x >= center ? 12 : -12);
          const valueAnchor = valuePoint.x >= center ? 'start' : 'end';
          const valueTagY = valuePoint.y - 10;

          return (
            <g key={metric.key}>
              <line
                x1={center}
                y1={center}
                x2={axisPoint.x}
                y2={axisPoint.y}
                className="profile-radar-axis"
              />
              <circle cx={axisPoint.x} cy={axisPoint.y} r="4.2" className="profile-radar-axis-dot" />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="profile-radar-label"
              >
                {metric.label}
              </text>
              <text
                x={valueTagX}
                y={valueTagY}
                textAnchor={valueAnchor}
                className="profile-radar-value-text"
              >
                {metric.percent}
              </text>
              <circle
                cx={valuePoint.x}
                cy={valuePoint.y}
                r="9"
                className="profile-radar-node-halo"
              />
              <circle
                cx={valuePoint.x}
                cy={valuePoint.y}
                r="5.4"
                className="profile-radar-node"
              />
            </g>
          );
        })}

        <polygon points={dataPolygon} className="profile-radar-shape" filter="url(#profileRadarShadow)" />
      </svg>
    </div>
  );
}

function createEmptyLearningProfile(userId = null, syllabusId = null) {
  return {
    user_id: userId,
    syllabus_id: syllabusId,
    learning_goal: null,
    learning_style: null,
    dropout_risk: null,
    confidence: 0,
    knowledge_mastery: {
      overall_score: 0,
      answer_score: 0,
      syllabus_score: 0,
      engagement_score: 0,
      mastered_weeks: [],
      weak_weeks: [],
      overall_level: 'none',
      by_knowledge_point: {},
      knowledge_point_details: {},
    },
  };
}

export default function StudentDashboard({ navigate }) {
  const [syllabuses, setSyllabuses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState('');
  const [learningProfile, setLearningProfile] = useState(() => createEmptyLearningProfile());
  const [profileLoading, setProfileLoading] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [questionAsked, setQuestionAsked] = useState(false);
  const [answer, setAnswer] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationError, setRecommendationError] = useState('');
  const [recommendationResult, setRecommendationResult] = useState({
    graph: { nodes: [], edges: [] },
    candidates: [],
    selected: [],
    bestPath: null,
  });
  const [activeRecommendationPathKey, setActiveRecommendationPathKey] = useState('');
  const [expandedTimelineWeekId, setExpandedTimelineWeekId] = useState(null);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!getCurrentUserId()) {
        navigate('/login');
        setIsBooting(false);
        return;
      }

      setIsBooting(true);
      setError('');

      try {
        const response = await getStudentDashboardData();
        if (cancelled) {
          return;
        }
        setSyllabuses(response.syllabuses);
        setActiveId(response.syllabuses[0]?.syllabusId ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载失败');
        }
      } finally {
        if (!cancelled) {
          window.setTimeout(() => setIsBooting(false), 240);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!activeId || isBooting) {
      return undefined;
    }

    const activeSyllabus = syllabuses.find((item) => item.syllabusId === activeId) ?? null;
    if (!activeSyllabus) {
      return undefined;
    }

    let cancelled = false;
    const fallbackProfile = createEmptyLearningProfile(getCurrentUserId(), activeSyllabus.syllabusId);

    setLearningProfile(fallbackProfile);

    async function loadLearningProfile() {
      try {
        const profileRes = await getLearningProfile({
          syllabusId: activeSyllabus.syllabusId,
        });
        if (cancelled) {
          return;
        }

        setLearningProfile(profileRes?.profile ?? fallbackProfile);
      } catch {
        if (!cancelled) {
          setLearningProfile(fallbackProfile);
        }
      }
    }

    void loadLearningProfile();

    return () => {
      cancelled = true;
    };
  }, [activeId, isBooting, syllabuses]);

  const active = syllabuses.find((item) => item.syllabusId === activeId) ?? syllabuses[0] ?? null;
  const currentWeekIndex = useMemo(
    () => getCurrentWeekIndex(active?.dayOneTime, active?.personalSyllabus?.period?.length ?? 0),
    [active?.dayOneTime, active?.personalSyllabus?.period?.length],
  );
  const learningWeekCount = active?.personalSyllabus?.period?.length ?? 0;
  const profileMetrics = useMemo(() => {
    return DEFAULT_PROFILE_METRICS.map((metric) => {
      const rawValue = learningProfile?.knowledge_mastery?.[metric.key] ?? 0;
      return {
        ...metric,
        percent: normalizeProfileMetricValue(rawValue),
        valueText: formatProfileMetricValue(rawValue),
      };
    });
  }, [learningProfile]);
  const profileScore = useMemo(() => {
    if (!profileMetrics.length) {
      return 0;
    }

    return Math.round(
      profileMetrics.reduce((sum, metric) => sum + metric.percent, 0) / profileMetrics.length,
    );
  }, [profileMetrics]);
  const weakestKnowledgePoints = useMemo(() => {
    const detailMap = learningProfile?.knowledge_mastery?.knowledge_point_details;
    if (!detailMap || typeof detailMap !== 'object') {
      return [];
    }

    return Object.entries(detailMap)
      .map(([name, detail]) => ({
        name,
        score: normalizeProfileMetricValue(detail?.score ?? 0),
        attemptCount: Number(detail?.attempt_count ?? 0),
        level: detail?.level ?? 'unknown',
      }))
      .sort((left, right) => left.score - right.score)
      .slice(0, 4);
  }, [learningProfile]);
  const masteredWeekNumbers = useMemo(() => {
    const weeks = learningProfile?.knowledge_mastery?.mastered_weeks;
    if (!Array.isArray(weeks)) {
      return [];
    }

    return [...weeks]
      .map((week) => Number(week))
      .filter((week) => Number.isFinite(week) && week > 0)
      .sort((left, right) => left - right);
  }, [learningProfile]);
  const masteredWeekCoverage = useMemo(() => {
    if (!learningWeekCount) {
      return 0;
    }

    return clampPercent((masteredWeekNumbers.length / learningWeekCount) * 100);
  }, [learningWeekCount, masteredWeekNumbers]);
  const profileConfidence = useMemo(
    () => normalizeProfileMetricValue(learningProfile?.confidence ?? 0),
    [learningProfile],
  );
  const stageProgressPercent = useMemo(() => {
    if (!learningWeekCount || !currentWeekIndex) {
      return 0;
    }

    return Math.max(6, Math.min(100, Math.round((currentWeekIndex / learningWeekCount) * 100)));
  }, [currentWeekIndex, learningWeekCount]);
  const disabled = isBooting || !active || !active.isLearning || !active.personalSyllabus;
  const isStudentLoading = isBooting && !active;

  useEffect(() => {
    setExpandedTimelineWeekId(null);
    setIsAnswerExpanded(false);
    setRecommendationError('');
    setRecommendationResult({
      graph: { nodes: [], edges: [] },
      candidates: [],
      selected: [],
      bestPath: null,
    });
    setActiveRecommendationPathKey('');
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecommendation() {
      if (!active?.syllabusId || !active?.isLearning || !active?.personalSyllabus || isBooting) {
        return;
      }

      setRecommendationLoading(true);
      setRecommendationError('');

      try {
        const response = await getPersonalRecommendation({
          syllabusId: active.syllabusId,
          syllabusTitle: active.title,
          personalSyllabus: active.personalSyllabus,
          learningProfile,
        });

        if (cancelled) {
          return;
        }

        if (!response.success) {
          throw new Error(response.errorMessage || '学习路径推荐加载失败');
        }

        setRecommendationResult(response);
        setActiveRecommendationPathKey(getPathKey(response.bestPath?.path ?? response.candidates[0]?.path ?? []));
      } catch (loadError) {
        if (!cancelled) {
          setRecommendationError(loadError instanceof Error ? loadError.message : '学习路径推荐加载失败');
          setRecommendationResult({
            graph: { nodes: [], edges: [] },
            candidates: [],
            selected: [],
            bestPath: null,
          });
          setActiveRecommendationPathKey('');
        }
      } finally {
        if (!cancelled) {
          setRecommendationLoading(false);
        }
      }
    }

    void loadRecommendation();

    return () => {
      cancelled = true;
    };
  }, [active?.isLearning, active?.personalSyllabus, active?.syllabusId, active?.title, isBooting, learningProfile]);

  const patchActive = (updater) => {
    setSyllabuses((current) => current.map((item) => (
      item.syllabusId === activeId ? updater(cloneData(item)) : item
    )));
  };

  const switchSyllabus = (offset) => {
    if (!syllabuses.length) {
      return;
    }

    const currentIndex = syllabuses.findIndex((item) => item.syllabusId === activeId);
    const nextIndex = (currentIndex + offset + syllabuses.length) % syllabuses.length;
    setActiveId(syllabuses[nextIndex].syllabusId);
    setQuestionAsked(false);
    setQuestionInput('');
    setAnswer('');
  };

  const recommendationItems = questionAsked
    ? active?.recommendedMaterials ?? []
    : active?.defaultRecommendations ?? [];
  const recommendationDownloadItems = recommendationItems.map((item) => ({
    ...item,
    onDownload: async (downloadItem) => {
      try {
        const result = await downloadFile(downloadItem.fileId, downloadItem.title);
        if (!result.success) {
          throw new Error(result.error_message || '下载失败');
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '下载失败');
      }
    },
  }));

  return (
    <MainLayout
      title="学生学习空间"
      actions={(
        <div className="header-actions">
          <Button variant="secondary" onClick={() => navigate('/login')}>返回登录</Button>
          <Button
            variant="primary"
            disabled={!active || initBusy}
            onClick={async () => {
              if (!active) {
                return;
              }

              setInitBusy(true);
              setError('');

              try {
                const currentUserId = getCurrentUserId();
                await initPersonalSyllabus({ syllabusId: active.syllabusId });
                const personalSyllabus = await getPersonalSyllabus({ syllabusId: active.syllabusId });
                patchActive((item) => {
                  item.isLearning = true;
                  item.personalSyllabus = personalSyllabus ?? item.personalSyllabus ?? {
                    syllabus_id: item.syllabusId,
                    user_id: currentUserId,
                    review_count: 0,
                    reviewed_at: 0,
                    period: [],
                  };
                  return item;
                });
              } catch (actionError) {
                setError(actionError instanceof Error ? actionError.message : '初始化失败');
              } finally {
                setInitBusy(false);
              }
            }}
          >
            {active?.isLearning ? '学习已开启' : initBusy ? '处理中...' : '开始学习'}
          </Button>
        </div>
      )}
    >
      <section className="dashboard-shell student-dashboard-shell">
        <section className="dashboard-hero student-dashboard-hero">
          <div className="student-dashboard-hero-main">
            <div className="student-dashboard-copy">
              <p className="student-dashboard-kicker">Student Workspace</p>
              <h2>{active ? `${active.title} 学习空间` : '学生学习空间'}</h2>
              <p>
                围绕当前课程集中展示学习画像、推荐路径与问答材料。
              </p>
            </div>

            <div className="student-dashboard-hero-stats">
              <div className="student-hero-stat-card">
                <span>课程状态</span>
                <strong>{active?.isLearning ? '学习中' : '待开始'}</strong>
              </div>
              <div className="student-hero-stat-card">
                <span>当前周次</span>
                <strong>{currentWeekIndex ? `第${currentWeekIndex}周` : '未开始'}</strong>
              </div>
              <div className="student-hero-stat-card">
                <span>画像总分</span>
                <strong>{`${profileScore}/100`}</strong>
              </div>
              <div className="student-hero-stat-card">
                <span>推荐材料</span>
                <strong>{`${recommendationDownloadItems.length} 份`}</strong>
              </div>
            </div>
          </div>

          <div className="student-dashboard-switcher">
            <SyllabusSwitcher
              items={syllabuses}
              activeId={activeId ?? 0}
              onChange={setActiveId}
              onPrev={() => switchSyllabus(-1)}
              onNext={() => switchSyllabus(1)}
              disabled={isBooting || !syllabuses.length}
              learningLabel={active?.isLearning ? '学习中' : '未学习'}
            />
          </div>

          {active ? (
            <div className="student-dashboard-badges">
              <StatusPill tone={questionAsked ? 'success' : 'neutral'}>
                {questionAsked ? '答疑结果已更新' : '尚未提问'}
              </StatusPill>
            </div>
          ) : null}
        </section>

        {active ? (
          <section className="student-page-body">
            <aside className="student-identity-card">
              <div className="student-identity-top">
                <div className="student-identity-avatar">学</div>
                <div className="student-identity-copy">
                  <p className="student-section-kicker">Profile Card</p>
                  <h3>{active.title}</h3>
                  <p>围绕当前课程提炼掌握状态、学习阶段和核心能力表现。</p>
                </div>
              </div>

              <div className="student-identity-scoreband">
                <div className="student-identity-score">
                  <span>画像总分</span>
                  <div className="student-identity-score-row">
                    <strong>{profileScore}</strong>
                    <small>/100</small>
                  </div>
                </div>
                <div className="student-identity-level">
                  <span>掌握等级</span>
                  <StatusPill tone={getMasteryTone(learningProfile.knowledge_mastery?.overall_level)}>
                    {formatMasteryLevel(learningProfile.knowledge_mastery?.overall_level)}
                  </StatusPill>
                </div>
              </div>

              <div className="student-stage-meter">
                <div className="student-stage-meter-head">
                  <span>当前学习阶段</span>
                  <strong>{currentWeekIndex ? `第 ${currentWeekIndex} / ${learningWeekCount} 周` : '待开始'}</strong>
                </div>
                <div className="student-stage-meter-track">
                  <div className="student-stage-meter-fill" style={{ width: `${stageProgressPercent}%` }} />
                </div>
              </div>

              <div className="student-identity-facts">
                <div className="student-identity-fact-card">
                  <span>路径候选</span>
                  <strong>{recommendationResult.candidates?.length ?? 0}</strong>
                </div>
                <div className="student-identity-fact-card">
                  <span>图节点</span>
                  <strong>{recommendationResult.graph?.nodes?.length ?? 0}</strong>
                </div>
                <div className="student-identity-fact-card">
                  <span>学习材料</span>
                  <strong>{recommendationDownloadItems.length}</strong>
                </div>
                <div className="student-identity-fact-card">
                  <span>画像置信度</span>
                  <strong>{`${profileConfidence}%`}</strong>
                </div>
              </div>
            </aside>

            <div className="student-mainstream">
              <section className="student-profile-workbench">
                <div className="student-section-head">
                  <div>
                    <p className="student-section-kicker">Learning Portrait</p>
                    <h3>学生学习画像</h3>
                  </div>
                  <Button
                    variant="primary"
                    className="button-compact"
                    disabled={profileLoading}
                    onClick={async () => {
                      if (!active) {
                        return;
                      }

                      setProfileLoading(true);
                      setError('');

                      try {
                        const response = await getLearningProfile({
                          syllabusId: active.syllabusId,
                        });

                        if (!response?.success) {
                          throw new Error(response?.errorMessage || '学习画像加载失败');
                        }

                        setLearningProfile(response.profile ?? createEmptyLearningProfile(getCurrentUserId(), active.syllabusId));
                      } catch (actionError) {
                        setError(actionError instanceof Error ? actionError.message : '学习画像加载失败');
                        setLearningProfile(createEmptyLearningProfile(getCurrentUserId(), active.syllabusId));
                      } finally {
                        setProfileLoading(false);
                      }
                    }}
                  >
                    {profileLoading ? '刷新中...' : '刷新'}
                  </Button>
                </div>

                {learningProfile ? (
                  <div className="student-profile-workbench-grid">
                    <div className="student-profile-radar-card">
                      <div className="student-profile-radar-head">
                        <strong>能力雷达</strong>
                        <span>综合呈现当前课程下的核心学习维度。</span>
                      </div>
                      <LearningProfileRadar metrics={profileMetrics} />
                    </div>

                    <div className="student-profile-side-panel">
                      <div className="student-profile-level-line">
                        <span>掌握等级</span>
                        <strong>{formatMasteryLevel(learningProfile.knowledge_mastery?.overall_level)}</strong>
                      </div>

                      <div className="student-profile-metrics student-profile-metrics-compact">
                        {profileMetrics.map((metric) => (
                          <div key={metric.key} className="student-profile-metric-card">
                            <div className="student-profile-metric-head">
                              <span>{metric.label}</span>
                              <strong>{metric.valueText}</strong>
                            </div>
                            <div className="student-profile-metric-track">
                              <div
                                className="student-profile-metric-fill"
                                style={{ width: `${metric.percent}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="student-profile-progress-strip">
                        <div className="student-profile-progress-item">
                          <div className="student-profile-progress-head">
                            <span>已掌握周次覆盖</span>
                            <strong>{learningWeekCount ? `${masteredWeekNumbers.length}/${learningWeekCount}` : '暂无'}</strong>
                          </div>
                          <div className="student-profile-progress-track">
                            <div className="student-profile-progress-fill" style={{ width: `${masteredWeekCoverage}%` }} />
                          </div>
                        </div>
                        <div className="student-profile-progress-item">
                          <div className="student-profile-progress-head">
                            <span>画像置信度</span>
                            <strong>{`${profileConfidence}%`}</strong>
                          </div>
                          <div className="student-profile-progress-track">
                            <div className="student-profile-progress-fill is-secondary" style={{ width: `${profileConfidence}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {weakestKnowledgePoints.length ? (
                      <div className="student-profile-detail-strip">
                        <div className="student-profile-bottleneck-card">
                          <span>知识点薄弱项</span>
                          <div className="student-profile-point-list student-profile-point-chart">
                            {weakestKnowledgePoints.map((point) => (
                              <div key={point.name} className="student-profile-point-item">
                                <div className="student-profile-point-head">
                                  <strong>{point.name}</strong>
                                  <span>{`${point.score}%`}</span>
                                </div>
                                <div className="student-profile-point-track">
                                  <div className="student-profile-point-fill" style={{ width: `${point.score}%` }} />
                                </div>
                                {point.attemptCount > 0 ? (
                                  <small>{`答题记录 ${point.attemptCount} 次`}</small>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="student-content-stream">
                <section className="student-surface student-surface-path">
                  <div className="student-surface-head">
                    <div className="student-surface-head-copy">
                      <p className="student-section-kicker">Recommendation</p>
                      <h3>学习路径推荐</h3>
                      <p className="student-section-subcopy">优先展示当前课程下最值得推进的主链路，并高亮最佳路径。</p>
                    </div>
                  </div>
                  {isStudentLoading ? (
                    <LoadingPlaceholder size="panel" />
                  ) : (
                    <DisabledBlock disabled={disabled} message="请先选择学习，系统会基于当前课程生成推荐路径">
                      {recommendationError ? (
                        <EmptyState>{recommendationError}</EmptyState>
                      ) : (
                        <LearningRecommendationPath
                          recommendation={recommendationResult}
                          activePathKey={activeRecommendationPathKey}
                          onSelectPath={setActiveRecommendationPathKey}
                          loading={recommendationLoading}
                          onRefresh={async () => {
                            if (!active?.syllabusId) {
                              return;
                            }

                            setRecommendationLoading(true);
                            setRecommendationError('');

                            try {
                              const response = await getPersonalRecommendation({
                                syllabusId: active.syllabusId,
                                syllabusTitle: active.title,
                                personalSyllabus: active.personalSyllabus,
                                learningProfile,
                              });

                              if (!response.success) {
                                throw new Error(response.errorMessage || '学习路径推荐加载失败');
                              }

                              setRecommendationResult(response);
                              setActiveRecommendationPathKey(getPathKey(response.bestPath?.path ?? response.candidates[0]?.path ?? []));
                            } catch (actionError) {
                              setRecommendationError(actionError instanceof Error ? actionError.message : '学习路径推荐加载失败');
                            } finally {
                              setRecommendationLoading(false);
                            }
                          }}
                        />
                      )}
                    </DisabledBlock>
                  )}
                </section>

                <div className={['student-dialog-grid', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
                  <section className="student-surface student-surface-qa">
                    <div className="student-surface-head">
                      <div className="student-surface-head-copy">
                        <p className="student-section-kicker">Q&A</p>
                        <h3>智能问答</h3>
                        <p className="student-section-subcopy">面向当前课程直接提问，并把回答与大纲更新联动起来。</p>
                      </div>
                      <div className="tile-head-controls">
                        <StatusPill tone={questionAsked ? 'success' : 'neutral'}>
                          {questionAsked ? '已提问' : '待提问'}
                        </StatusPill>
                        <Button variant="ghost" onClick={() => setIsAnswerExpanded((current) => !current)}>
                          {isAnswerExpanded ? '收起' : '展开回答'}
                        </Button>
                      </div>
                    </div>
                    {isStudentLoading ? (
                      <LoadingPlaceholder size="answer" />
                    ) : (
                      <DisabledBlock disabled={disabled} message="请先选择学习">
                        <div className={['question-grid', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
                          <section className="response-panel">
                            <label className="field">
                              <span>问题</span>
                              <textarea
                                rows="4"
                                value={questionInput}
                                placeholder="例如：ETL 在这里具体负责什么？"
                                onChange={(event) => setQuestionInput(event.target.value)}
                              />
                            </label>
                            <div className="tile-actions">
                              <Button
                                variant="primary"
                                disabled={askBusy || !questionInput.trim()}
                                onClick={async () => {
                                  setAskBusy(true);
                                  setError('');

                                  try {
                                    const response = await askQuestion({
                                      syllabusId: active.syllabusId,
                                      question: questionInput,
                                    });
                                    const personalSyllabus = await getPersonalSyllabus({ syllabusId: active.syllabusId });
                                    setQuestionAsked(true);
                                    setAnswer(response.answer);
                                    patchActive((item) => {
                                      item.recommendedMaterials = response.recommendedMaterials;
                                      item.personalSyllabus = personalSyllabus ?? item.personalSyllabus;
                                      return item;
                                    });
                                  } catch (actionError) {
                                    setError(actionError instanceof Error ? actionError.message : '提问失败');
                                  } finally {
                                    setAskBusy(false);
                                  }
                                }}
                              >
                                {askBusy ? '处理中...' : '提交提问'}
                              </Button>
                            </div>
                          </section>
                          <section className={['response-panel', 'response-panel-answer', isAnswerExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}>
                            <strong className="response-title">回答</strong>
                            <p className={['response-copy', isAnswerExpanded ? 'is-expanded' : 'is-condensed'].filter(Boolean).join(' ')}>
                              {answer || '尚未提问。'}
                            </p>
                          </section>
                        </div>
                      </DisabledBlock>
                    )}
                  </section>

                  <section className="student-surface student-surface-materials">
                    <div className="student-surface-head">
                      <div className="student-surface-head-copy">
                        <p className="student-section-kicker">Resources</p>
                        <h3>推荐材料</h3>
                        <p className="student-section-subcopy">根据默认学习阶段或问答结果，直接提供可下载材料。</p>
                      </div>
                      <StatusPill tone={questionAsked ? 'success' : 'warning'}>
                        {questionAsked ? 'AI' : '默认'}
                      </StatusPill>
                    </div>
                    {isStudentLoading ? (
                      <LoadingPlaceholder size="shelf" />
                    ) : (
                      <DisabledBlock disabled={disabled} message="请先选择学习">
                        <MaterialShelf items={recommendationDownloadItems} emptyText="暂无可展示的推荐材料。" />
                      </DisabledBlock>
                    )}
                  </section>
                </div>

                <section className="student-surface student-surface-syllabus">
                  <div className="student-surface-head student-surface-head-muted">
                    <div className="student-surface-head-copy">
                      <p className="student-section-kicker">Learning Timeline</p>
                      <h3>周次进度</h3>
                      <p className="student-section-subcopy">按周查看当前课程推进情况，细节按需展开。</p>
                    </div>
                  </div>
                  {isStudentLoading ? (
                    <LoadingPlaceholder size="axis" />
                  ) : (
                    <DisabledBlock disabled={disabled} message="请先点击“开始学习”初始化个人进度">
                      <div className="student-timeline-band">
                        <WeekAxis
                          items={active.personalSyllabus?.period ?? []}
                          mode="competance"
                          currentWeek={currentWeekIndex}
                          expandedItemId={expandedTimelineWeekId}
                          onToggleExpand={(itemId) => {
                            setExpandedTimelineWeekId((current) => (current === itemId ? null : itemId));
                          }}
                        />
                      </div>
                    </DisabledBlock>
                  )}
                </section>
              </section>
            </div>
          </section>
        ) : null}

        {error ? <EmptyState>{error}</EmptyState> : null}
        {!error && !active && !isBooting ? <EmptyState>暂无教学大纲。</EmptyState> : null}
      </section>
    </MainLayout>
  );
}
