import { useEffect, useMemo, useRef, useState } from 'react';
import './student-dashboard.css';
import { USE_MOCK_API } from '../api/client';
import {
  askQuestionRaw,
  getLearningProfileRaw,
  getPersonalSyllabusRaw,
  getStudyGraph,
  listStudentSyllabusesRaw,
  parseAskQuestionResponse,
  parseLearningProfileResponse,
  parsePersonalSyllabusResponse,
  parseStudentSyllabusListResponse,
} from '../api/learning_api';
import { getCurrentUserId } from '../api/session';
import {
  getPersonalRecommendationRaw,
  parseRecommendationResponse,
} from '../api/personal_recommendation_api';
import RecommendationRouteViewer, { countRecommendationRoutes } from '../components/RecommendationRouteViewer';
import StudyGraphOverlay from '../components/StudyGraphOverlay';
import { Button } from '../components/DashboardShared';
import StudentSyllabusGantt from '../components/StudentSyllabusGantt';
import externalPersonalSyllabusResponse from '../../../mock/learning_profile/learning_personal_syllabus_detail.response.json';
import externalUserLearningProfileResponse from '../../../mock/learning_profile/user_learning_profile.response.json';
import externalStudyGraphResponse from '../../../mock/study_graph/learning_study_graph.response.json';
import externalGenerativeListResponse from '../../../mock/generative/generative_list.response.json';
import externalGenerativeDetailDocumentsResponse from '../../../mock/generative/generative_detail_documents.response.json';
import externalGenerativeDetailMindmapResponse from '../../../mock/generative/generative_detail_mindmap.response.json';
import externalGenerativeDetailPptResponse from '../../../mock/generative/generative_detail_ppt.response.json';
import externalGenerativeDetailQuizResponse from '../../../mock/generative/generative_detail_quiz.response.json';

const OUTPUT_FORMAT_LABELS = {
  documents: 'MD',
  mindmap: '脑图',
  quiz: '小测',
  ppt: 'PPT',
  coding_practice: '实操',
};

const RISK_LABELS = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const EMOTION_LABELS = {
  positive: '积极',
  neutral: '平稳',
  frustrated: '受挫',
};

const AGENT_TONE_OPTIONS = [
  { value: 'friendly_pragmatic', label: '友善务实' },
  { value: 'pragmatic', label: '直接务实' },
  { value: 'encouraging', label: '鼓励引导' },
];

const AGENT_ANSWER_STYLE_OPTIONS = [
  { value: 'normal', label: '标准回答' },
  { value: 'concise', label: '简短准确' },
  { value: 'detailed', label: '详细展开' },
];

const RESOURCE_TYPE_META = {
  ppt: { label: 'PPT', shortLabel: 'P' },
  documents: { label: '文档', shortLabel: '文' },
  mindmap: { label: '思维导图', shortLabel: '图' },
  quiz: { label: '练习', shortLabel: 'M' },
  coding_practice: { label: '代码实验', shortLabel: '<>' },
};

const EXTERNAL_GENERATIVE_DETAIL_BY_ID = {
  [externalGenerativeDetailDocumentsResponse?.material?.resource_id ?? '']: externalGenerativeDetailDocumentsResponse?.material ?? null,
  [externalGenerativeDetailMindmapResponse?.material?.resource_id ?? '']: externalGenerativeDetailMindmapResponse?.material ?? null,
  [externalGenerativeDetailPptResponse?.material?.resource_id ?? '']: externalGenerativeDetailPptResponse?.material ?? null,
  [externalGenerativeDetailQuizResponse?.material?.resource_id ?? '']: externalGenerativeDetailQuizResponse?.material ?? null,
};

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric <= 1 && numeric >= 0) {
    return numeric;
  }
  if (numeric > 1 && numeric <= 100) {
    return numeric / 100;
  }
  if (numeric < 0) {
    return 0;
  }
  return 1;
}

function readScore(candidate) {
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return clamp01(candidate.score);
  }
  return clamp01(candidate);
}

function formatPercent(value) {
  const normalized = clamp01(value);
  if (normalized == null) {
    return '--';
  }
  return `${Math.round(normalized * 100)}%`;
}

function formatCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : '--';
}

function formatDateTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '--';
  }
  const date = new Date(numeric * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function formatDateGroupLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '未标记日期';
  }
  const date = new Date(numeric * 1000);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function getCurrentWeekIndex(dayOneTime, totalWeeks) {
  if (!dayOneTime || !totalWeeks) {
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
  return Math.min(Math.max(weekIndex, 1), totalWeeks);
}

function buildRadarMetrics(profile) {
  if (!profile) {
    return [];
  }

  const knowledgeMastery = profile.knowledge_mastery ?? {};
  const sources = [
    { key: 'overall', label: '综合', value: readScore(knowledgeMastery.overall_score) },
    { key: 'syllabus', label: '大纲', value: readScore(knowledgeMastery.syllabus_score) },
    { key: 'answer', label: '作答', value: readScore(knowledgeMastery.answer_score) },
    { key: 'engagement', label: '投入', value: readScore(knowledgeMastery.engagement_score) },
    { key: 'goal', label: '目标', value: readScore(profile.goal_clarity) },
    { key: 'term', label: '术语', value: readScore(profile.term_familiarity) },
  ];

  return sources.filter((item) => item.value != null);
}

function buildRadarGeometry(metrics) {
  if (metrics.length < 3) {
    return null;
  }

  const size = 280;
  const center = size / 2;
  const radius = 92;
  const labelRadius = 124;
  const angleStep = (Math.PI * 2) / metrics.length;

  const axes = metrics.map((metric, index) => {
    const angle = -Math.PI / 2 + angleStep * index;
    return {
      ...metric,
      angle,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      labelX: center + Math.cos(angle) * labelRadius,
      labelY: center + Math.sin(angle) * labelRadius,
      pointX: center + Math.cos(angle) * radius * metric.value,
      pointY: center + Math.sin(angle) * radius * metric.value,
    };
  });

  const levels = [0.25, 0.5, 0.75, 1].map((level) => ({
    level,
    points: axes.map((axis) => `${center + Math.cos(axis.angle) * radius * level},${center + Math.sin(axis.angle) * radius * level}`).join(' '),
  }));

  return {
    size,
    center,
    axes,
    levels,
    shapePoints: axes.map((axis) => `${axis.pointX},${axis.pointY}`).join(' '),
  };
}

function buildPathTitleMap(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  return new Map(nodes.map((node) => [String(node.id), node.title || String(node.id)]));
}

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

function buildRecommendationRouteLayout(recommendation, candidate) {
  const path = Array.isArray(candidate?.path) ? candidate.path.map((item) => String(item)) : [];
  if (!path.length) {
    return null;
  }

  const titleMap = buildPathTitleMap(recommendation?.graph);
  const width = 860;
  const height = 360;
  const centerY = height / 2;
  const sidePadding = 92;
  const amplitude = path.length >= 5 ? 58 : 44;
  const step = path.length > 1 ? (width - sidePadding * 2) / (path.length - 1) : 0;

  const nodes = path.map((nodeId, index) => {
    const isStart = index === 0;
    const isEnd = index === path.length - 1;
    const direction = index % 2 === 0 ? -1 : 1;
    const y = isStart || isEnd ? centerY : centerY + direction * amplitude;
    return {
      id: `${candidate?.id || 'route'}-${nodeId}-${index}`,
      nodeId,
      title: titleMap.get(nodeId) || nodeId,
      lines: splitRouteLabel(titleMap.get(nodeId) || nodeId),
      stepLabel: String(index + 1).padStart(2, '0'),
      x: sidePadding + step * index,
      y,
      r: isStart || isEnd ? 22 : 18,
      tone: isStart ? 'start' : (isEnd ? 'end' : 'mid'),
      labelBelow: y <= centerY,
    };
  });

  const edges = nodes.slice(0, -1).map((node, index) => {
    const target = nodes[index + 1];
    const midpointX = (node.x + target.x) / 2;
    const midpointY = (node.y + target.y) / 2;
    const verticalLift = index % 2 === 0 ? -34 : 34;
    return {
      id: `${node.id}->${target.id}`,
      d: `M ${node.x} ${node.y} C ${midpointX - 32} ${midpointY + verticalLift}, ${midpointX + 32} ${midpointY + verticalLift}, ${target.x} ${target.y}`,
    };
  });

  return {
    width,
    height,
    nodes,
    edges,
  };
}

function buildProfileSummary(profile) {
  if (!profile) {
    return [];
  }

  const items = [
    ['学习目标', profile.learning_goal || ''],
    ['目标层级', profile.target_level || ''],
    ['学习风格', profile.learning_style || ''],
    ['情绪状态', EMOTION_LABELS[profile?.emotion_state?.label] || ''],
    ['理解水平', profile.comprehension_level || ''],
    ['练习能力', profile.practice_ability || ''],
  ];

  return items.filter((item) => item[1]);
}

function buildProgressTiles(profile, studyGraph) {
  if (!profile) {
    return [null, null];
  }

  const knowledgeMastery = profile.knowledge_mastery ?? {};
  const signals = profile.signals ?? {};
  const features = studyGraph?.features ?? {};

  return [
    {
      title: '学习节奏',
      lines: [
        ['近 7 天活跃', `${formatCount(signals.active_days_7d)} 天`],
        ['近 30 天活跃', `${formatCount(signals.active_days_30d)} 天`],
        ['平均单次时长', `${formatCount(signals.avg_duration_minutes)} 分钟`],
        ['树成长值', formatPercent(features.tree_growth)],
      ],
    },
    {
      title: '风险与掌握',
      lines: [
        ['画像置信度', formatPercent(profile.confidence)],
        ['流失风险', RISK_LABELS[profile.dropout_risk] || '无风险数据'],
        ['弱项周次', `${Array.isArray(knowledgeMastery.weak_weeks) ? knowledgeMastery.weak_weeks.length : 0} 周`],
        ['已掌握周次', `${Array.isArray(knowledgeMastery.mastered_weeks) ? knowledgeMastery.mastered_weeks.length : 0} 周`],
      ],
    },
  ];
}

function buildResolvedPersonalSyllabus(personalSyllabus, profile, activeSyllabus) {
  if (Array.isArray(personalSyllabus?.period) && personalSyllabus.period.length) {
    return personalSyllabus;
  }

  const weekItems = Array.isArray(profile?.knowledge_mastery?.week_items)
    ? profile.knowledge_mastery.week_items
    : [];

  if (!weekItems.length) {
    return personalSyllabus;
  }

  return {
    ...personalSyllabus,
    title: personalSyllabus?.title ?? profile?.subject_title ?? activeSyllabus?.title ?? '',
    day_one: personalSyllabus?.day_one ?? activeSyllabus?.dayOneTime ?? '',
    period: weekItems.map((item) => ({
      week_index: item.week_index,
      content: item.content ?? '',
      enhanced_content: item.enhanced_content ?? item.content ?? '',
      competance: item.competance ?? 'none',
      competance_progress: item.competance_progress ?? 0,
      importance: item.importance ?? 'medium',
      day_one: item.day_one ?? '',
    })),
  };
}

function getGraphNodeTone(node) {
  const label = String(node?.mastery?.label || node?.display?.color_state || '').toLowerCase();
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

function buildStaticGraphLayout(studyGraph) {
  const tree = studyGraph?.tree ?? {};
  const nodes = Array.isArray(tree.nodes) ? tree.nodes : [];
  const root = tree.virtual_root ?? null;

  if (!root || !nodes.length) {
    return null;
  }

  const positionedNodes = [
    {
      id: String(root.node_id),
      title: String(root.title || tree.subject_title || '课程知识树'),
      summary: String(tree.title || ''),
      score: 1,
      tone: 'root',
      x: 280,
      y: 56,
      r: 18,
    },
  ];

  const presets = [
    { x: 164, y: 138 },
    { x: 280, y: 186 },
    { x: 128, y: 262 },
    { x: 432, y: 262 },
    { x: 396, y: 138 },
    { x: 216, y: 308 },
  ];

  nodes.forEach((node, index) => {
    const preset = presets[index] ?? {
      x: 96 + ((index % 4) * 112),
      y: 132 + (Math.floor(index / 4) * 92),
    };
    positionedNodes.push({
      id: String(node.node_id),
      title: String(node.title || '未命名知识点'),
      summary: String(node.summary || ''),
      score: clamp01(node?.mastery?.score) ?? 0,
      tone: getGraphNodeTone(node),
      x: preset.x,
      y: preset.y,
      r: 16,
    });
  });

  const nodeMap = new Map(positionedNodes.map((node) => [node.id, node]));
  const edges = [];
  const rawEdges = Array.isArray(tree.edges) ? tree.edges : [];
  const incoming = new Set(rawEdges.map((edge) => String(edge.target)));

  rawEdges.forEach((edge) => {
    const source = nodeMap.get(String(edge.source));
    const target = nodeMap.get(String(edge.target));
    if (!source || !target) {
      return;
    }
    edges.push({
      id: String(edge.edge_id || `${source.id}-${target.id}`),
      source,
      target,
    });
  });

  positionedNodes.slice(1).forEach((node) => {
    if (incoming.has(node.id)) {
      return;
    }
    edges.push({
      id: `${root.node_id}-${node.id}`,
      source: positionedNodes[0],
      target: node,
    });
  });

  return {
    width: 560,
    height: 328,
    nodes: positionedNodes,
    edges,
  };
}

function DataRefusal({ title, message }) {
  return (
    <div className="student-data-refusal">
      <p>暂无数据</p>
    </div>
  );
}

function StaticStudyGraphCard({ studyGraph }) {
  const layout = useMemo(() => buildStaticGraphLayout(studyGraph), [studyGraph]);

  if (!layout) {
    return <DataRefusal />;
  }

  return (
    <div className="student-static-graph">
      <svg
        className="student-static-graph-svg"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label="学习进度记录树图谱"
      >
        <defs>
          <filter id="studentStaticGraphGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {layout.edges.map((edge) => (
          <path
            key={edge.id}
            className="student-static-graph-edge"
            d={`M ${edge.source.x} ${edge.source.y} C ${edge.source.x} ${(edge.source.y + edge.target.y) / 2}, ${edge.target.x} ${(edge.source.y + edge.target.y) / 2}, ${edge.target.x} ${edge.target.y}`}
          />
        ))}
        {layout.nodes.map((node) => (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <circle
              className={`student-static-graph-halo tone-${node.tone}`}
              r={node.r * 1.95}
              filter="url(#studentStaticGraphGlow)"
            />
            <circle className={`student-static-graph-node tone-${node.tone}`} r={node.r} />
            <text className="student-static-graph-title" textAnchor="middle" y={-node.r - 14}>
              {node.title}
            </text>
            <text className="student-static-graph-score" textAnchor="middle" y={node.r + 18}>
              {node.tone === 'root' ? '课程根' : `${Math.round(node.score * 100)}%`}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function RadarChartPanel({ profile }) {
  const metrics = useMemo(() => buildRadarMetrics(profile), [profile]);
  const geometry = useMemo(() => buildRadarGeometry(metrics), [metrics]);

  if (!geometry) {
    return (
      <DataRefusal
        title="拒绝渲染雷达图"
        message="学习画像缺少足够的数值轴。请补充 `knowledge_mastery`、`goal_clarity`、`term_familiarity` 等真实字段。"
      />
    );
  }

  return (
    <div className="student-radar-wrap">
      <svg
        className="student-radar"
        viewBox={`0 0 ${geometry.size} ${geometry.size}`}
        role="img"
        aria-label="个人学习画像雷达图"
      >
        {geometry.levels.map((levelItem) => (
          <polygon
            key={levelItem.level}
            className="student-radar-grid"
            points={levelItem.points}
          />
        ))}
        {geometry.axes.map((axis) => (
          <line
            key={axis.key}
            className="student-radar-axis"
            x1={geometry.center}
            y1={geometry.center}
            x2={axis.axisX}
            y2={axis.axisY}
          />
        ))}
        <polygon
          className="student-radar-shape"
          points={geometry.shapePoints}
        />
        {geometry.axes.map((axis) => (
          <g key={`${axis.key}-point`}>
            <circle
              className="student-radar-point"
              cx={axis.pointX}
              cy={axis.pointY}
              r="4"
            />
            <text
              className="student-radar-label"
              x={axis.labelX}
              y={axis.labelY}
            >
              {axis.label}
            </text>
            <text
              className="student-radar-value"
              x={axis.pointX}
              y={axis.pointY - 8}
            >
              {Math.round(axis.value * 100)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function SubjectList({ syllabuses, activeSyllabusId, onSelect }) {
  if (!syllabuses.length) {
    return (
      <DataRefusal
        title="拒绝渲染科目列表"
        message="`/api/syllabus_list` 没有返回可学习科目，请先补充课程数据。"
      />
    );
  }

  return (
    <div className="student-subject-switcher">
      <div className="student-subject-list" role="list" aria-label="可学习科目">
        {syllabuses.map((item, index) => {
          const isActive = item.syllabusId === activeSyllabusId;
          return (
            <button
              key={item.syllabusId}
              type="button"
              className={`student-subject-item ${isActive ? 'is-active' : ''}`}
              onClick={() => onSelect(item.syllabusId)}
            >
              <span className="student-subject-item-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="student-subject-item-copy">
                <strong>{item.title}</strong>
                <small>{item.isLearning ? '学习中' : '已接入'}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationPanel({ recommendation, expanded = false }) {
  const candidates = useMemo(() => buildCandidateList(recommendation), [recommendation]);
  const [routeIndex, setRouteIndex] = useState(0);
  const activeCandidate = candidates[((routeIndex % Math.max(candidates.length, 1)) + Math.max(candidates.length, 1)) % Math.max(candidates.length, 1)] ?? null;
  const layout = useMemo(
    () => buildRecommendationRouteLayout(recommendation, activeCandidate),
    [activeCandidate, recommendation],
  );

  if (!candidates.length) {
    return (
      <DataRefusal
        title="拒绝渲染推荐路径"
        message="推荐接口没有返回可切换路线，前端不会自行生成路线 1 / 路线 2 / 路线 3。"
      />
    );
  }

  if (!layout) {
    return <DataRefusal />;
  }

  return (
    <div className={['student-route-panel', expanded ? 'is-expanded' : ''].join(' ')}>
      <div className={['student-route-graph-card', expanded ? 'is-expanded' : ''].join(' ')}>
        <div className="student-route-graph">
          <svg
            className="student-route-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="推荐学习路径图"
          >
            <defs>
              <filter id="studentRouteGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            {layout.edges.map((edge) => (
              <path key={edge.id} className="student-route-svg-line" d={edge.d} />
            ))}
            {layout.nodes.map((node) => (
              <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
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
          </svg>
        </div>
      </div>
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

function RecommendationOverlay({ open, recommendation, onClose }) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="student-route-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="推荐学习路径原图"
    >
      <div className="student-route-overlay-shell">
        <div className="student-route-overlay-head">
          <div className="student-route-overlay-copy">
            <h2>推荐学习路径</h2>
            <p>完整路线图</p>
          </div>
        <div className="student-route-overlay-actions">
          <button type="button" className="student-route-overlay-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
        <RecommendationRouteViewer recommendation={recommendation} expanded />
      </div>
    </div>
  );
}

function QuestionPanel({
  questionDraft,
  onQuestionDraftChange,
  onSubmit,
  qaState,
  toneStyle,
  onToneStyleChange,
  answerStyle,
  onAnswerStyleChange,
}) {
  return (
    <form className="student-qa-panel" onSubmit={onSubmit}>
      <div className="student-qa-body">
        <div className="student-qa-topbar">
          <div className="student-qa-topbar-copy">
            <strong>问答窗口</strong>
          </div>
          <div className="student-qa-control-grid">
            <label className="field student-qa-chip-field">
              <span>语气</span>
              <select
                className="select-field"
                value={toneStyle}
                onChange={(event) => onToneStyleChange(event.target.value)}
              >
                {AGENT_TONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="field student-qa-chip-field">
              <span>回答风格</span>
              <select
                className="select-field"
                value={answerStyle}
                onChange={(event) => onAnswerStyleChange(event.target.value)}
              >
                {AGENT_ANSWER_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="student-qa-console">
          {qaState.response?.answer ? (
            <div className="student-qa-answer">
              <strong>回答</strong>
              <p>{qaState.response.answer}</p>
              {qaState.response.answerPayload?.nextActions?.length ? (
                <small>
                  下一动作：
                  {qaState.response.answerPayload.nextActions.map((item) => item.action).join(' / ')}
                </small>
              ) : null}
            </div>
          ) : null}
          {qaState.error ? (
            <p className="student-inline-error">{qaState.error}</p>
          ) : null}
        </div>
        <div className="student-qa-compose">
          <div className="student-qa-input-shell">
            <label className="field">
              <span>输入问题</span>
              <textarea
                value={questionDraft}
                onChange={(event) => onQuestionDraftChange(event.target.value)}
                placeholder="围绕当前课程输入问题..."
              />
            </label>
            <div className="student-qa-actions">
              <Button
                variant="secondary"
                className="student-qa-send-button"
                disabled={qaState.loading || !questionDraft.trim()}
                type="submit"
                aria-label={qaState.loading ? '发送中' : '发送'}
                title={qaState.loading ? '发送中' : '发送'}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M4 12h12m-5-5 5 5-5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function normalizeResourceItem(item = {}) {
  return {
    resourceId: String(item.resource_id ?? item.resourceId ?? ''),
    resourceType: String(item.resource_type ?? item.resourceType ?? ''),
    title: String(item.title ?? '未命名资源'),
    topic: String(item.topic ?? ''),
    status: String(item.status ?? ''),
    syllabusId: item.syllabus_id ?? item.syllabusId ?? null,
    createdAt: Number(item.created_at ?? item.createdAt ?? 0) || 0,
    updatedAt: Number(item.updated_at ?? item.updatedAt ?? 0) || 0,
    metadata: typeof item.metadata === 'object' && item.metadata ? item.metadata : {},
    mainFiles: typeof item.main_files === 'object' && item.main_files ? item.main_files : (item.mainFiles ?? {}),
    content: typeof item.content === 'object' && item.content ? item.content : null,
    render: typeof item.render === 'object' && item.render ? item.render : {},
  };
}

function buildGeneratedResourceLibrary(syllabusId, fallbackMaterials = []) {
  const externalItems = Array.isArray(externalGenerativeListResponse?.materials)
    ? externalGenerativeListResponse.materials
    : [];
  const source = externalItems.length ? externalItems : fallbackMaterials;
  const normalized = source.map(normalizeResourceItem);
  const filtered = normalized.filter((item) => !syllabusId || String(item.syllabusId ?? '') === String(syllabusId));
  const resolved = filtered.length ? filtered : normalized;

  return resolved
    .sort((left, right) => (
      Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)
      || String(left.title).localeCompare(String(right.title), 'zh-Hans-CN')
    ));
}

function resolveGeneratedResourceDetail(resource) {
  if (!resource) {
    return null;
  }

  const detail = EXTERNAL_GENERATIVE_DETAIL_BY_ID[resource.resourceId];
  return normalizeResourceItem(detail ?? resource);
}

function buildResourceFileList(resource) {
  return Object.entries(resource?.mainFiles ?? {})
    .filter(([, path]) => path)
    .map(([key, path]) => ({
      key,
      label: key.replace(/_path$/i, '').toUpperCase(),
      path: String(path),
    }));
}

function getResourcePrimaryExtension(resource) {
  const files = Object.values(resource?.mainFiles ?? {}).filter(Boolean).map((value) => String(value));
  const preferredPatterns = [
    /\.pptx?$/i,
    /\.pdf$/i,
    /\.md$/i,
    /\.mmd$/i,
    /\.py$/i,
    /\.js$/i,
    /\.json$/i,
  ];

  for (const pattern of preferredPatterns) {
    const matched = files.find((file) => pattern.test(file));
    if (matched) {
      return matched.split('.').pop()?.toUpperCase() ?? '';
    }
  }

  return files[0]?.split('.').pop()?.toUpperCase() ?? '';
}

function estimateResourceSize(resource) {
  const serialized = JSON.stringify({
    metadata: resource?.metadata ?? {},
    mainFiles: resource?.mainFiles ?? {},
    content: resource?.content ?? {},
    render: resource?.render ?? {},
  });
  const sizeInKb = Math.max(24, Math.round((serialized.length || 0) / 32));

  if (sizeInKb >= 1024) {
    return `${(sizeInKb / 1024).toFixed(1)} MB`;
  }

  return `${sizeInKb} KB`;
}

function groupResourcesByDay(items = []) {
  const groups = [];
  const map = new Map();

  items.forEach((item) => {
    const numeric = Number(item.createdAt ?? 0);
    const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric * 1000) : null;
    const key = date
      ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
      : 'unknown';

    if (!map.has(key)) {
      const group = {
        key,
        label: formatDateGroupLabel(item.createdAt),
        items: [],
      };
      map.set(key, group);
      groups.push(group);
    }

    map.get(key).items.push(item);
  });

  return groups;
}

function getResourceFilePaths(resource) {
  return Object.values(resource?.mainFiles ?? {}).filter(Boolean).map((value) => String(value));
}

function isImageResource(resource) {
  return getResourceFilePaths(resource).some((path) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path));
}

function parseMarkdownBlocks(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let code = [];
  let inCode = false;
  let codeLanguage = '';

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }
    const text = paragraph.join('\n').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraph = [];
  }

  function flushCode() {
    if (!code.length) {
      return;
    }
    blocks.push({ type: 'code', language: codeLanguage, code: code.join('\n') });
    code = [];
    codeLanguage = '';
  }

  lines.forEach((line) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
        codeLanguage = line.trim().slice(3).trim();
      }
      return;
    }

    if (inCode) {
      code.push(line);
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      return;
    }

    if (/^[-*]\s+/.test(line.trim())) {
      flushParagraph();
      blocks.push({ type: 'list_item', text: line.trim().replace(/^[-*]\s+/, '') });
      return;
    }

    paragraph.push(line);
  });

  flushParagraph();
  flushCode();

  return blocks;
}

function ResourceLibraryPanel({ items, selectedResourceId, onSelect }) {
  const scrollTimerRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);

  useEffect(() => () => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
    }
  }, []);

  if (!items.length) {
    return <DataRefusal />;
  }

  const groups = groupResourcesByDay(items);

  return (
    <div
      className={`student-resource-library-list ${isScrolling ? 'is-scrolling' : ''}`}
      onScroll={() => {
        setIsScrolling(true);
        if (scrollTimerRef.current) {
          window.clearTimeout(scrollTimerRef.current);
        }
        scrollTimerRef.current = window.setTimeout(() => setIsScrolling(false), 900);
      }}
    >
      {groups.map((group) => (
        <section key={group.key} className="student-resource-group">
          <h3>{group.label}</h3>
          <div className="student-resource-group-list">
            {group.items.map((item) => {
              const meta = RESOURCE_TYPE_META[item.resourceType] ?? { label: item.resourceType || '资源', shortLabel: 'F' };
              const isActive = item.resourceId === selectedResourceId;
              const detail = resolveGeneratedResourceDetail(item);
              const extension = getResourcePrimaryExtension(detail || item) || meta.label.toUpperCase();
              const size = estimateResourceSize(detail || item);

              return (
                <button
                  key={item.resourceId}
                  type="button"
                  className={`student-resource-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelect(item.resourceId)}
                >
                  <span className={`student-resource-file-icon is-${item.resourceType || 'default'}`}>{meta.shortLabel}</span>
                  <span className="student-resource-item-copy">
                    <strong>{item.title}</strong>
                    <small>{`${size} · ${extension}`}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ResourcePreviewPanel({ resource }) {
  const scrollTimerRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);
  const [activeResource, setActiveResource] = useState(resource);
  const [previousResource, setPreviousResource] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isImageExpanded, setIsImageExpanded] = useState(false);

  useEffect(() => {
    if (!resource || resource.resourceId === activeResource?.resourceId) {
      return undefined;
    }

    setPreviousResource(activeResource);
    setActiveResource(resource);
    setIsTransitioning(true);

    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }

    transitionTimerRef.current = window.setTimeout(() => {
      setPreviousResource(null);
      setIsTransitioning(false);
    }, 320);

    return undefined;
  }, [activeResource, resource]);

  useEffect(() => () => {
    if (scrollTimerRef.current) {
      window.clearTimeout(scrollTimerRef.current);
    }
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
  }, []);

  if (!resource && !activeResource) {
    return <DataRefusal />;
  }

  const currentResource = activeResource ?? resource;
  const markdownBlocks = parseMarkdownBlocks(currentResource?.render?.markdown ?? '');
  const codeFiles = Array.isArray(currentResource?.content?.code_files) ? currentResource.content.code_files : [];
  const imageSource = getResourceFilePaths(currentResource).find((path) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path)) ?? '';

  function renderPreviewStack(targetResource, layerClass = '') {
    if (!targetResource) {
      return null;
    }

    const pptSlides = Array.isArray(targetResource.content?.slides) ? targetResource.content.slides : [];
    const quizQuestions = Array.isArray(targetResource.content?.questions) ? targetResource.content.questions : [];
    const mindmapNodes = Array.isArray(targetResource.content?.nodes) ? targetResource.content.nodes : [];

    return (
      <div className={`student-preview-stack ${layerClass}`.trim()}>
        {targetResource.resourceType === 'ppt' && pptSlides.length ? (
          pptSlides.map((slide) => (
            <article key={`${targetResource.resourceId}-${slide.slide_index}`} className="student-preview-sheet">
              <div className="student-preview-sheet-body is-ppt">
                <div className="student-preview-ppt-icon">P</div>
                <div className="student-preview-ppt-copy">
                  <strong>{slide.title}</strong>
                  <p>{slide.body}</p>
                </div>
              </div>
            </article>
          ))
        ) : null}

        {targetResource.resourceType === 'documents' && markdownBlocks.length ? (
          <article className="student-preview-sheet is-document">
            <div className="student-preview-document">
              {markdownBlocks.map((block, index) => {
                if (block.type === 'heading') {
                  const Tag = block.level <= 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3';
                  return <Tag key={`${targetResource.resourceId}-heading-${index}`}>{block.text}</Tag>;
                }
                if (block.type === 'list_item') {
                  return <p key={`${targetResource.resourceId}-list-${index}`} className="student-preview-list-item">{`• ${block.text}`}</p>;
                }
                if (block.type === 'code') {
                  const lines = block.code.split('\n');
                  return (
                    <div key={`${targetResource.resourceId}-code-${index}`} className="student-preview-codeblock">
                      <div className="student-preview-code-gutter">
                        {lines.map((_, lineIndex) => <span key={lineIndex}>{lineIndex + 1}</span>)}
                      </div>
                      <pre><code>{block.code}</code></pre>
                    </div>
                  );
                }
                return <p key={`${targetResource.resourceId}-paragraph-${index}`}>{block.text}</p>;
              })}
            </div>
          </article>
        ) : null}

        {targetResource.resourceType === 'mindmap' ? (
          <article className="student-preview-sheet">
            <div className="student-preview-sheet-body is-mindmap">
              <strong>{targetResource.content?.root ?? targetResource.title}</strong>
              <div className="student-resource-chip-list">
                {mindmapNodes.map((node) => <span key={node}>{node}</span>)}
              </div>
            </div>
          </article>
        ) : null}

        {targetResource.resourceType === 'quiz' && quizQuestions.length ? (
          quizQuestions.map((question, index) => (
            <article key={`${targetResource.resourceId}-question-${question.id ?? index}`} className="student-preview-sheet">
              <div className="student-preview-sheet-body is-quiz">
                <strong>{question.stem}</strong>
                <p>{Array.isArray(question.options) ? question.options.join(' / ') : ''}</p>
              </div>
            </article>
          ))
        ) : null}

        {targetResource.resourceType === 'coding_practice' && codeFiles.length ? (
          codeFiles.map((file) => {
            const lines = String(file.content ?? '').split('\n');
            return (
              <article key={`${targetResource.resourceId}-${file.path}`} className="student-preview-sheet is-document">
                <div className="student-preview-codeblock is-full">
                  <div className="student-preview-code-gutter">
                    {lines.map((_, lineIndex) => <span key={lineIndex}>{lineIndex + 1}</span>)}
                  </div>
                  <pre><code>{file.content}</code></pre>
                </div>
              </article>
            );
          })
        ) : null}

        {isImageResource(targetResource) && imageSource ? (
          <article className="student-preview-sheet">
            <div className="student-preview-image-wrap">
              <button type="button" className="student-preview-image-button" onClick={() => setIsImageExpanded(true)}>
                <img src={imageSource} alt={targetResource.title} className="student-preview-image" />
              </button>
            </div>
          </article>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className={`student-resource-preview-shell ${isTransitioning ? 'is-transitioning' : ''}`}>
        <div
          className={`student-resource-preview-panel ${isScrolling ? 'is-scrolling' : ''}`}
          onScroll={() => {
            setIsScrolling(true);
            if (scrollTimerRef.current) {
              window.clearTimeout(scrollTimerRef.current);
            }
            scrollTimerRef.current = window.setTimeout(() => setIsScrolling(false), 900);
          }}
        >
          <div className="student-preview-stage">
            {previousResource && isTransitioning ? renderPreviewStack(previousResource, 'is-leaving') : null}
            {renderPreviewStack(currentResource, isTransitioning ? 'is-entering' : 'is-active')}
            {isTransitioning ? <div className="student-preview-flash" /> : null}
          </div>
        </div>
      </div>

      {isImageExpanded && imageSource ? (
        <div className="student-preview-image-overlay" role="dialog" aria-modal="true" onClick={() => setIsImageExpanded(false)}>
          <img src={imageSource} alt={currentResource.title} className="student-preview-image-full" />
        </div>
      ) : null}
    </>
  );
}

export default function StudentDashboard() {
  const currentUserId = getCurrentUserId();
  const [studentView, setStudentView] = useState('overview');
  const [syllabuses, setSyllabuses] = useState([]);
  const [activeSyllabusId, setActiveSyllabusId] = useState(null);
  const [dashboard, setDashboard] = useState({
    loading: true,
    error: '',
    personalSyllabus: null,
    profile: null,
    studyGraph: null,
    recommendation: null,
  });
  const [questionDraft, setQuestionDraft] = useState('');
  const [qaState, setQaState] = useState({
    loading: false,
    error: '',
    response: null,
  });
  const [toneStyle, setToneStyle] = useState('friendly_pragmatic');
  const [answerStyle, setAnswerStyle] = useState('normal');
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [recommendationViewerOpen, setRecommendationViewerOpen] = useState(false);
  const [studyGraphViewerOpen, setStudyGraphViewerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSubjects() {
      if (!USE_MOCK_API && !currentUserId) {
        if (!cancelled) {
          setDashboard((current) => ({
            ...current,
            loading: false,
            error: '当前没有登录会话，学生页已停止请求接口。请先登录，再进入学生端。',
          }));
        }
        return;
      }

      try {
        const response = await listStudentSyllabusesRaw();
        const parsed = parseStudentSyllabusListResponse(response);
        if (cancelled) {
          return;
        }
        setSyllabuses(parsed);
        setActiveSyllabusId(parsed[0]?.syllabusId ?? null);
        if (!parsed.length) {
          setDashboard((current) => ({
            ...current,
            loading: false,
            error: '没有可学习科目，学生页拒绝继续渲染。',
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setDashboard((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : '加载科目失败',
          }));
        }
      }
    }

    loadSubjects();
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!activeSyllabusId) {
      return undefined;
    }

    if (!USE_MOCK_API && !currentUserId) {
      return undefined;
    }

    let cancelled = false;

    async function loadDashboard() {
      setDashboard((current) => ({
        ...current,
        loading: true,
        error: '',
      }));

      try {
        const [personalRaw, profileRaw, studyGraph] = await Promise.all([
          getPersonalSyllabusRaw(activeSyllabusId),
          getLearningProfileRaw({ syllabusId: activeSyllabusId }),
          getStudyGraph({ syllabusId: activeSyllabusId }),
        ]);

        const personalSyllabus = parsePersonalSyllabusResponse(personalRaw);
        const profilePayload = parseLearningProfileResponse(profileRaw);
        const recommendationRaw = await getPersonalRecommendationRaw({
          syllabusId: activeSyllabusId,
          goals: profilePayload.profile?.learning_goal ? [profilePayload.profile.learning_goal] : undefined,
        });
        const recommendation = parseRecommendationResponse(recommendationRaw);

        if (!cancelled) {
          setDashboard({
            loading: false,
            error: '',
            personalSyllabus,
            profile: profilePayload.profile,
            studyGraph,
            recommendation,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setDashboard({
            loading: false,
            error: error instanceof Error ? error.message : '学生端数据加载失败',
            personalSyllabus: null,
            profile: null,
            studyGraph: null,
            recommendation: null,
          });
        }
      }
    }

    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [activeSyllabusId, currentUserId]);

  const activeSyllabus = useMemo(
    () => syllabuses.find((item) => item.syllabusId === activeSyllabusId) ?? null,
    [activeSyllabusId, syllabuses],
  );
  const resolvedProfile = useMemo(
    () => (USE_MOCK_API ? (externalUserLearningProfileResponse?.profile ?? dashboard.profile) : dashboard.profile),
    [dashboard.profile],
  );
  const resolvedStudyGraph = useMemo(
    () => (USE_MOCK_API ? (externalStudyGraphResponse ?? dashboard.studyGraph) : dashboard.studyGraph),
    [dashboard.studyGraph],
  );
  const resolvedRecommendation = useMemo(
    () => dashboard.recommendation,
    [dashboard.recommendation],
  );
  const recommendationRouteCount = useMemo(
    () => countRecommendationRoutes(resolvedRecommendation),
    [resolvedRecommendation],
  );
  const profileSummary = useMemo(
    () => buildProfileSummary(resolvedProfile),
    [resolvedProfile],
  );
  const resolvedPersonalSyllabus = useMemo(
    () => buildResolvedPersonalSyllabus(
      USE_MOCK_API ? (externalPersonalSyllabusResponse?.syllabus ?? dashboard.personalSyllabus) : dashboard.personalSyllabus,
      resolvedProfile,
      activeSyllabus,
    ),
    [activeSyllabus, dashboard.personalSyllabus, resolvedProfile],
  );
  const progressTiles = useMemo(
    () => buildProgressTiles(resolvedProfile, resolvedStudyGraph),
    [resolvedProfile, resolvedStudyGraph],
  );
  const resourceLibrary = useMemo(
    () => buildGeneratedResourceLibrary(activeSyllabusId),
    [activeSyllabusId],
  );
  const selectedResource = useMemo(
    () => resolveGeneratedResourceDetail(
      resourceLibrary.find((item) => item.resourceId === selectedResourceId) ?? resourceLibrary[0] ?? null,
    ),
    [resourceLibrary, selectedResourceId],
  );

  useEffect(() => {
    if (!resourceLibrary.length) {
      setSelectedResourceId('');
      return;
    }

    setSelectedResourceId((current) => (
      resourceLibrary.some((item) => item.resourceId === current)
        ? current
        : resourceLibrary[0].resourceId
    ));
  }, [resourceLibrary]);

  async function handleQuestionSubmit(event) {
    event.preventDefault();
    if (!questionDraft.trim() || !activeSyllabusId || USE_MOCK_API || !currentUserId) {
      return;
    }

    setQaState({
      loading: true,
      error: '',
      response: null,
    });

    try {
      const raw = await askQuestionRaw({
        syllabusId: activeSyllabusId,
        question: questionDraft.trim(),
        message: questionDraft.trim(),
        toneStyle,
        answerStyle,
      });
      const response = parseAskQuestionResponse(raw);
      setQaState({
        loading: false,
        error: response.success ? '' : (response.errorMessage || '问答失败'),
        response,
      });
    } catch (error) {
      setQaState({
        loading: false,
        error: error instanceof Error ? error.message : '问答失败',
        response: null,
      });
    }
  }

  function handleAdvance() {
    setStudentView('resources');
  }

  function handleRetreat() {
    setStudentView('overview');
  }

  const sidebar = (
    <aside className="student-column student-column-left">
      <section className="student-section">
        <div className="student-panel-head student-head-blue">
          <span>科目选择</span>
        </div>
        <SubjectList
          syllabuses={syllabuses}
          activeSyllabusId={activeSyllabusId}
          onSelect={setActiveSyllabusId}
        />
      </section>

      <QuestionPanel
        questionDraft={questionDraft}
        onQuestionDraftChange={setQuestionDraft}
        onSubmit={handleQuestionSubmit}
        qaState={qaState}
        toneStyle={toneStyle}
        onToneStyleChange={setToneStyle}
        answerStyle={answerStyle}
        onAnswerStyleChange={setAnswerStyle}
      />
    </aside>
  );

  if (dashboard.error) {
    return (
      <div className="student-workspace">
        <div className="student-full-error">
          <h1>学生端拒绝渲染</h1>
          <p>{dashboard.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`student-workspace ${studentView === 'resources' ? 'is-resource-view' : ''}`}>
      {sidebar}

      {studentView === 'resources' ? (
        <>
          <aside className="student-column student-column-resource-nav">
            <button
              type="button"
              className="student-next-button student-prev-button"
              onClick={handleRetreat}
              aria-label="返回上一界面"
            >
              {'<'}
            </button>
          </aside>

          <main className="student-column student-column-resource-main">
            <section className="student-resource-grid">
              <div className="student-grid-cell student-resource-library">
                <div className="student-panel-head student-head-black student-resource-section-head">
                  <span>课程资料</span>
                </div>
                <div className="student-resource-panel-body">
                  <ResourceLibraryPanel
                    items={resourceLibrary}
                    selectedResourceId={selectedResourceId}
                    onSelect={setSelectedResourceId}
                  />
                </div>
              </div>

              <div className="student-grid-cell student-resource-preview">
                <div className="student-panel-head student-head-black student-resource-section-head">
                  <span>预览</span>
                  <button type="button" className="student-resource-toolbar-button" aria-label="下载">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 18h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </div>
                <div className="student-resource-panel-body">
                  <ResourcePreviewPanel resource={selectedResource} />
                </div>
              </div>
            </section>
          </main>
        </>
      ) : (
        <>
          <main className="student-column student-column-center">
            <section className="student-portrait-grid">
              <div className="student-grid-cell student-grid-radar">
                <div className="student-panel-head student-head-black">
                  <span>学习画像雷达图</span>
                </div>
                {dashboard.loading ? (
                  <p className="student-loading">正在读取学习画像...</p>
                ) : (
                  <RadarChartPanel profile={resolvedProfile} />
                )}
              </div>

              <div className="student-grid-cell student-grid-summary">
                <div className="student-summary-grid">
                  <section className="student-summary-section">
                    <h3>画像摘要</h3>
                    {profileSummary.length ? (
                      <dl className="student-definition-list">
                        {profileSummary.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <DataRefusal
                        title="拒绝渲染画像摘要"
                        message="`/api/user_learning_profile` 缺少可展示的文本画像字段。"
                      />
                    )}
                  </section>

                  <section className="student-summary-section">
                    <h3>{progressTiles[0]?.title || '学习节奏'}</h3>
                    {progressTiles[0]?.lines?.length ? (
                      <dl className="student-mini-list">
                        {progressTiles[0].lines.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : <DataRefusal />}
                  </section>

                  <section className="student-summary-section">
                    <h3>偏好形式</h3>
                    {(resolvedProfile?.resource_preference?.length
                      ? resolvedProfile.resource_preference
                      : ['ppt', 'documents', 'quiz']).length ? (
                      <div className="student-format-list">
                        {(resolvedProfile?.resource_preference?.length
                          ? resolvedProfile.resource_preference
                          : ['ppt', 'documents', 'quiz']).map((item) => (
                          <span key={item} className="student-format-tag">
                            {OUTPUT_FORMAT_LABELS[item] || item}
                          </span>
                        ))}
                      </div>
                    ) : <DataRefusal />}
                  </section>

                  <section className="student-summary-section">
                    <h3>{progressTiles[1]?.title || '风险与掌握'}</h3>
                    {progressTiles[1]?.lines?.length ? (
                      <dl className="student-mini-list">
                        {progressTiles[1].lines.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : <DataRefusal />}
                  </section>
                </div>
              </div>

              <div className="student-grid-cell student-grid-gantt">
                <div className="student-panel-head student-head-black">
                  <span>教学大纲简化甘特图</span>
                </div>
                <StudentSyllabusGantt
                  personalSyllabus={resolvedPersonalSyllabus}
                  dayOneTime={activeSyllabus?.dayOneTime ?? null}
                />
              </div>
            </section>

            <section className="student-bottom-grid">
              <div className="student-grid-cell student-bottom-left">
                <div className="student-panel-head student-head-green">
                  <span>学习推荐路径</span>
                  {recommendationRouteCount ? (
                    <Button
                      variant="ghost"
                      className="student-record-expand student-record-expand-head"
                      onClick={() => setRecommendationViewerOpen(true)}
                    >
                      查看原图
                    </Button>
                  ) : null}
                </div>
                <RecommendationRouteViewer recommendation={resolvedRecommendation} />
              </div>

              <div className="student-grid-cell student-bottom-right">
                <div className="student-panel-head student-head-orange">
                  <span>学习进度记录</span>
                  {resolvedStudyGraph?.tree?.nodes?.length ? (
                    <Button
                      variant="ghost"
                      className="student-record-expand student-record-expand-head"
                      onClick={() => setStudyGraphViewerOpen(true)}
                    >
                      查看原图
                    </Button>
                  ) : null}
                </div>
                {resolvedStudyGraph?.tree?.nodes?.length ? (
                  <div className="student-record-panel">
                    <div className="student-record-graph">
                      <StudyGraphOverlay
                        inline
                        fill
                        inlineMinimal
                        open
                        bundle={resolvedStudyGraph}
                        onClose={() => {}}
                      />
                    </div>
                  </div>
                ) : <DataRefusal />}
              </div>
            </section>
          </main>

          <aside className="student-column student-column-right">
            <button
              type="button"
              className="student-next-button"
              onClick={handleAdvance}
              aria-label="进入下一界面"
            >
              {'>'}
            </button>
          </aside>
        </>
      )}

      {resolvedStudyGraph?.tree?.nodes?.length ? (
        <StudyGraphOverlay
          open={studyGraphViewerOpen}
          bundle={resolvedStudyGraph}
          onClose={() => setStudyGraphViewerOpen(false)}
        />
      ) : null}

      {recommendationRouteCount ? (
        <RecommendationOverlay
          open={recommendationViewerOpen}
          recommendation={resolvedRecommendation}
          onClose={() => setRecommendationViewerOpen(false)}
        />
      ) : null}

    </div>
  );
}
