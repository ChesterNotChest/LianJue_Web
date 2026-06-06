import { useEffect, useMemo, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import StudyGraphOverlay from '../components/StudyGraphOverlay';
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
  getStudyGraph,
  getStudentDashboardData,
  initPersonalSyllabus,
} from '../api/learning_api';
import { getPersonalRecommendation } from '../api/personal_recommendation_api';
import {
  getGeneratedResourceDetail,
  getGeneratedResourceTypeMeta,
  listGeneratedResources,
} from '../api/generative_api';
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

function getMasteryLevelClassName(level) {
  const normalized = String(level ?? '').toLowerCase();

  if (normalized === 'master') {
    return 'is-master';
  }
  if (normalized === 'normal') {
    return 'is-normal';
  }
  if (normalized === 'weak') {
    return 'is-weak';
  }
  if (normalized === 'none') {
    return 'is-none';
  }
  return 'is-unknown';
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

function resolveRecommendationLevel(nodeMap, nodeId, cache = new Map(), stack = new Set()) {
  if (cache.has(nodeId)) {
    return cache.get(nodeId);
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
    ? Math.max(...prerequisites.map((item) => resolveRecommendationLevel(nodeMap, item, cache, stack) + 1))
    : 0;
  stack.delete(nodeId);
  cache.set(nodeId, level);
  return level;
}

function buildRecommendationDisplay(candidate, nodes = [], edges = []) {
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const edgeMap = new Map(edges.map((edge) => [`${String(edge.source)}->${String(edge.target)}`, edge]));
  const primaryPath = Array.isArray(candidate?.path) ? candidate.path.map((item) => String(item)) : [];
  const primaryPathSet = new Set(primaryPath);
  const primaryEdgeSet = new Set();
  const activeNodeSet = new Set(primaryPath);
  const activeEdgeSet = new Set((candidate?.path_edges ?? []).map((edge) => edge.edge_id));
  const supportNodeSet = new Set();
  const levelCache = new Map();
  const visited = new Set();

  const collectPrerequisites = (nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    const prerequisites = Array.isArray(node?.prerequisites) ? node.prerequisites.map((item) => String(item)) : [];

    prerequisites.forEach((prerequisiteId) => {
      activeNodeSet.add(prerequisiteId);
      if (!primaryPathSet.has(prerequisiteId)) {
        supportNodeSet.add(prerequisiteId);
      }

      const edge = edgeMap.get(`${prerequisiteId}->${nodeId}`);
      if (edge?.edge_id) {
        activeEdgeSet.add(edge.edge_id);
      }

      collectPrerequisites(prerequisiteId);
    });
  };

  if (Array.isArray(candidate?.path_edges) && candidate.path_edges.length) {
    candidate.path_edges.forEach((edge) => {
      if (edge?.edge_id) {
        primaryEdgeSet.add(edge.edge_id);
      }
    });
  } else {
    for (let index = 0; index < primaryPath.length - 1; index += 1) {
      const edge = edgeMap.get(`${primaryPath[index]}->${primaryPath[index + 1]}`);
      if (edge?.edge_id) {
        primaryEdgeSet.add(edge.edge_id);
        activeEdgeSet.add(edge.edge_id);
      }
    }
  }

  primaryPath.forEach(collectPrerequisites);

  const sortNodeIds = (nodeIds = []) => (
    [...nodeIds].sort((left, right) => (
      resolveRecommendationLevel(nodeMap, String(left), levelCache) - resolveRecommendationLevel(nodeMap, String(right), levelCache)
      || String(nodeMap.get(String(left))?.title ?? '').localeCompare(String(nodeMap.get(String(right))?.title ?? ''), 'zh-Hans-CN')
    ))
  );

  const startNodeIds = sortNodeIds(
    [...activeNodeSet].filter((nodeId) => {
      const prerequisites = Array.isArray(nodeMap.get(nodeId)?.prerequisites)
        ? nodeMap.get(nodeId).prerequisites.map((item) => String(item))
        : [];
      return !prerequisites.some((item) => activeNodeSet.has(item));
    }),
  );

  const supportNodeIds = sortNodeIds([...supportNodeSet]);
  const startNodeSet = new Set(startNodeIds);

  return {
    primaryPath,
    primaryPathSet,
    primaryEdgeSet,
    activeNodeSet,
    activeEdgeSet,
    supportNodeSet,
    startNodeSet,
    startNodeIds,
    startTitles: startNodeIds.map((nodeId) => nodeMap.get(nodeId)?.title ?? nodeId).filter(Boolean),
    primaryTitles: primaryPath.map((nodeId) => nodeMap.get(nodeId)?.title ?? nodeId).filter(Boolean),
    supportTitles: supportNodeIds.map((nodeId) => nodeMap.get(nodeId)?.title ?? nodeId).filter(Boolean),
    targetNodeId: primaryPath.length ? primaryPath[primaryPath.length - 1] : '',
    targetTitle: primaryPath.length ? (nodeMap.get(primaryPath[primaryPath.length - 1])?.title ?? primaryPath[primaryPath.length - 1]) : '',
  };
}

function buildRecommendationReason(candidate, nodeMap, recommendation, display) {
  if (recommendation?.meta?.reason) {
    return recommendation.meta.reason;
  }

  if (!candidate || !Array.isArray(candidate.path) || !candidate.path.length) {
    return '当前还没有可用的推荐路径。';
  }

  const titles = display?.primaryTitles?.length
    ? display.primaryTitles
    : candidate.path.map((nodeId) => nodeMap.get(String(nodeId))?.title ?? String(nodeId)).filter(Boolean);
  const supportTitles = display?.supportTitles ?? [];

  if (supportTitles.length) {
    return `推荐理由：当前最佳候选的主路径是 ${titles.join(' -> ')}，但要真正到达目标节点，还需要先补 ${supportTitles.join('、')} 这些先修知识。`;
  }

  if (titles.length <= 3) {
    return `推荐理由：当前主题已经直接命中核心知识点，系统优先返回这条更短的关键链路：${titles.join(' -> ')}。`;
  }

  return `推荐理由：这条路径在当前候选里综合评分最高，并且满足先修关系，建议按 ${titles.join(' -> ')} 的顺序推进。`;
}

function formatAgentIntentLabel(intent) {
  switch (intent) {
    case 'recommend_learning_path':
      return '学习路径推荐';
    case 'accept_recommendation':
      return '采纳推荐路径';
    case 'generate_current_step_resource':
      return '生成当前资源';
    case 'record_learning_feedback':
      return '记录学习反馈';
    case 'skip_current_step':
      return '跳过当前步骤';
    case 'answer_learning_question':
      return '即时答疑';
    case 'ask_goal_clarification':
      return '目标澄清';
    default:
      return '总 Agent';
  }
}

function formatAgentActionLabel(action) {
  switch (action) {
    case 'wait_user_acceptance':
      return '等待采纳';
    case 'generate_current_step_resource':
      return '生成当前步骤资源';
    case 'record_learning_feedback':
      return '记录反馈';
    case 'get_next_learning_task':
      return '查看下一步';
    case 'ask_goal_clarification':
      return '补充目标';
    case 'retry_recommendation':
      return '重试推荐';
    case 'continue_existing_plan':
      return '继续当前计划';
    case 'offer_practice_or_resource':
      return '给出练习或资料';
    case 'offer_resource':
      return '推荐资料';
    case 'offer_practice':
      return '推荐练习';
    case 'continue_current_step':
      return '继续当前步骤';
    case 'clarify_goal':
      return '澄清目标';
    default:
      return action || '暂无';
  }
}

function formatAgentQuestionTypeLabel(questionType) {
  switch (questionType) {
    case 'concept_explanation':
      return '概念解释';
    case 'learning_strategy':
      return '学习策略';
    case 'exercise_help':
      return '习题帮助';
    case 'unknown':
      return '自动判断';
    default:
      return questionType || '未分类';
  }
}

function formatAgentToneLabel(toneStyle) {
  return AGENT_TONE_OPTIONS.find((item) => item.value === toneStyle)?.label ?? '默认语气';
}

function formatAgentAnswerStyleLabel(answerStyle) {
  return AGENT_ANSWER_STYLE_OPTIONS.find((item) => item.value === answerStyle)?.label ?? '默认风格';
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
  const columns = buildRecommendationColumns(nodes);
  const treeLayout = buildRecommendationTreeLayout(columns);
  const nodeMap = new Map(nodes.map((node) => [String(node.id), node]));
  const activeDisplay = buildRecommendationDisplay(activeCandidate, nodes, recommendation?.graph?.edges ?? []);
  const recommendationReason = buildRecommendationReason(activeCandidate, nodeMap, recommendation, activeDisplay);
  const activePathEdgeSet = activeDisplay.activeEdgeSet;
  const primaryPathNodeSet = activeDisplay.primaryPathSet;
  const primaryPathEdgeSet = activeDisplay.primaryEdgeSet;
  const supportNodeSet = activeDisplay.supportNodeSet;
  const activePathTitles = activeDisplay.primaryTitles;

  return (
    <div className="recommendation-panel">
      <div className="recommendation-toolbar">
        <div className="recommendation-summary-strip">
          <strong>{activeCandidate?.selected ? '当前最佳路径' : '候选路径'}</strong>
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
          {activeDisplay.startTitles.length ? (
            <div className="recommendation-focus-item">
              <span className="recommendation-focus-label">起点</span>
              <strong>{activeDisplay.startTitles.join('、')}</strong>
            </div>
          ) : null}
          <div className="recommendation-focus-item">
            <span className="recommendation-focus-label">主路径</span>
            <strong>{activePathTitles.join(' → ')}</strong>
          </div>
          {activeDisplay.supportTitles.length ? (
            <div className="recommendation-focus-item">
              <span className="recommendation-focus-label">必经先修</span>
              <strong>{activeDisplay.supportTitles.join('、')}</strong>
            </div>
          ) : null}
          {activeDisplay.targetTitle ? (
            <div className="recommendation-focus-item">
              <span className="recommendation-focus-label">目标</span>
              <strong>{activeDisplay.targetTitle}</strong>
            </div>
          ) : null}
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
            <span>深色高亮是主路径，浅色高亮是完成目标所需的先修节点。</span>
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
                      className={[
                        'recommendation-tree-edge',
                        primaryPathEdgeSet.has(edge.edge_id) ? 'is-active' : '',
                        !primaryPathEdgeSet.has(edge.edge_id) && activePathEdgeSet.has(edge.edge_id) ? 'is-support' : '',
                      ].filter(Boolean).join(' ')}
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

                const isPrimaryNode = primaryPathNodeSet.has(nodeId);
                const isSupportNode = supportNodeSet.has(nodeId);
                const stepIndex = activeDisplay.primaryPath.findIndex((item) => String(item) === nodeId);
                let stepLabel = '可衔接';

                if (nodeId === activeDisplay.targetNodeId) {
                  stepLabel = '目标节点';
                } else if (isSupportNode && activeDisplay.startNodeSet.has(nodeId)) {
                  stepLabel = '起点基础';
                } else if (isSupportNode) {
                  stepLabel = '必经先修';
                } else if (isPrimaryNode) {
                  stepLabel = '主路径';
                }

                return (
                  <article
                    key={nodeId}
                    className={[
                      'recommendation-tree-node',
                      isPrimaryNode ? 'is-active-node' : '',
                      isSupportNode ? 'is-support-node' : '',
                    ].filter(Boolean).join(' ')}
                    style={{
                      left: `${position.x}px`,
                      top: `${position.y}px`,
                      width: `${position.width}px`,
                      minHeight: `${position.height}px`,
                    }}
                  >
                    <div
                      className={[
                        'recommendation-tree-circle',
                        isPrimaryNode ? 'is-active-circle' : '',
                        isSupportNode ? 'is-support-circle' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {isPrimaryNode ? <span className="recommendation-tree-step">{stepIndex + 1}</span> : <span className="recommendation-tree-dot" />}
                    </div>
                    <div
                      className={[
                        'recommendation-tree-label',
                        isPrimaryNode ? 'is-active-label' : '',
                        isSupportNode ? 'is-support-label' : '',
                      ].filter(Boolean).join(' ')}
                    >
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

function formatResourceTime(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return '刚刚生成';
  }

  const date = new Date(numericValue * 1000);
  if (Number.isNaN(date.getTime())) {
    return '刚刚生成';
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMainFileLabel(key) {
  if (key === 'json_path') {
    return 'JSON';
  }
  if (key === 'md_path') {
    return 'Markdown';
  }
  if (key === 'mermaid_path') {
    return 'Mermaid';
  }
  if (key === 'pptx_path') {
    return 'PPTX';
  }
  return key;
}

function MindmapNodeList({ nodes = [] }) {
  if (!Array.isArray(nodes) || !nodes.length) {
    return null;
  }

  return (
    <ul className="generated-resource-tree-list">
      {nodes.map((node, index) => (
        <li key={`${node?.label ?? 'node'}-${index + 1}`}>
          <strong>{node?.label ?? '未命名节点'}</strong>
          <MindmapNodeList nodes={node?.children ?? []} />
        </li>
      ))}
    </ul>
  );
}

function GeneratedResourcePreview({ detail }) {
  if (!detail) {
    return <EmptyState>请选择左侧资源查看详情。</EmptyState>;
  }

  const type = detail.resourceType;
  const content = detail.content ?? {};
  const render = detail.render ?? {};

  if (type === 'documents') {
    return (
      <div className="generated-resource-preview">
        <div className="generated-resource-preview-intro">
          <strong>{content.summary || detail.topic || '讲解文档'}</strong>
          {render.markdown ? <pre className="generated-resource-markdown">{render.markdown}</pre> : null}
        </div>
        <div className="generated-resource-section-list">
          {(content.sections ?? []).map((section, index) => (
            <article key={`${section?.heading ?? 'section'}-${index + 1}`} className="generated-resource-section-card">
              <strong>{section?.heading ?? `章节 ${index + 1}`}</strong>
              <p>{section?.body ?? '暂无正文。'}</p>
              {Array.isArray(section?.key_points) && section.key_points.length ? (
                <div className="generated-resource-tag-row">
                  {section.key_points.map((item) => <span key={item}>{item}</span>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'mindmap') {
    return (
      <div className="generated-resource-preview">
        <div className="generated-resource-preview-intro">
          <strong>{content.root || detail.topic || '思维导图'}</strong>
          {render.mermaid ? <pre className="generated-resource-markdown">{render.mermaid}</pre> : null}
        </div>
        <MindmapNodeList nodes={content.nodes ?? []} />
      </div>
    );
  }

  if (type === 'quiz') {
    return (
      <div className="generated-resource-preview">
        <div className="generated-resource-section-list">
          {(content.questions ?? []).map((question, index) => (
            <article key={`${question?.id ?? 'q'}-${index + 1}`} className="generated-resource-section-card">
              <strong>{`${index + 1}. ${question?.stem ?? '未命名题目'}`}</strong>
              {Array.isArray(question?.options) && question.options.length ? (
                <div className="generated-resource-option-list">
                  {question.options.map((option, optionIndex) => (
                    <span key={`${option}-${optionIndex + 1}`}>{`${String.fromCharCode(65 + optionIndex)}. ${option}`}</span>
                  ))}
                </div>
              ) : null}
              <p>{`答案：${question?.answer ?? '暂无'}`}</p>
              <small>{question?.explanation ?? '暂无解析。'}</small>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'ppt') {
    return (
      <div className="generated-resource-preview">
        <div className="generated-resource-preview-intro">
          <strong>{content.summary || detail.topic || '复习课件'}</strong>
        </div>
        <div className="generated-resource-slide-list">
          {(content.slides ?? []).map((slide, index) => (
            <article key={`${slide?.title ?? 'slide'}-${index + 1}`} className="generated-resource-slide-card">
              <span>{`Slide ${index + 1}`}</span>
              <strong>{slide?.title ?? '未命名页面'}</strong>
              <p>{slide?.body ?? '暂无导语。'}</p>
              {Array.isArray(slide?.bullets) && slide.bullets.length ? (
                <div className="generated-resource-bullet-list">
                  {slide.bullets.map((bullet) => <span key={bullet}>{bullet}</span>)}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'coding_practice') {
    return (
      <div className="generated-resource-preview">
        <div className="generated-resource-section-list">
          <article className="generated-resource-section-card">
            <strong>学习目标</strong>
            <div className="generated-resource-bullet-list">
              {(content.learning_objectives ?? []).map((item) => <span key={item}>{item}</span>)}
            </div>
          </article>
          <article className="generated-resource-section-card">
            <strong>实践步骤</strong>
            <div className="generated-resource-bullet-list">
              {(content.steps ?? []).map((item) => <span key={item}>{item}</span>)}
            </div>
          </article>
          {(content.code_files ?? []).map((file, index) => (
            <article key={`${file?.path ?? 'code'}-${index + 1}`} className="generated-resource-section-card">
              <strong>{file?.path ?? `代码文件 ${index + 1}`}</strong>
              <pre className="generated-resource-markdown">{file?.content ?? ''}</pre>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="generated-resource-preview">
      <pre className="generated-resource-markdown">{JSON.stringify(content, null, 2)}</pre>
    </div>
  );
}

function GeneratedResourceWorkbench({
  active,
  loading,
  resources,
  selectedResourceId,
  onSelectResource,
  detail,
  detailLoading,
  recommendationDownloadItems,
}) {
  return (
    <div className="generated-resource-workbench">
      <div className="generated-resource-layout">
        <section className="generated-resource-list-panel">
          <div className="generated-resource-panel-head">
            <strong>已生成资源</strong>
            <span>{`${resources.length} 个`}</span>
          </div>
          {loading ? (
            <LoadingPlaceholder size="panel" />
          ) : resources.length ? (
            <div className="generated-resource-list">
              {resources.map((item) => {
                const meta = getGeneratedResourceTypeMeta(item.resourceType);
                const isActive = item.resourceId === selectedResourceId;
                return (
                  <button
                    key={item.resourceId}
                    type="button"
                    className={['generated-resource-list-item', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
                    onClick={() => onSelectResource(item.resourceId)}
                  >
                    <div className="generated-resource-list-top">
                      <StatusPill tone={meta.tone}>{meta.label}</StatusPill>
                      <span>{formatResourceTime(item.createdAt)}</span>
                    </div>
                    <strong>{item.title || item.topic || '未命名资源'}</strong>
                    <small>{item.topic || active?.title || '当前课程'}</small>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState>当前用户目录下还没有生成资源。</EmptyState>
          )}
        </section>

        <section className="generated-resource-detail-panel">
          <div className="generated-resource-panel-head">
            <strong>资源预览</strong>
            {detail ? (
              <StatusPill tone={detail.validation?.valid === false ? 'danger' : 'success'}>
                {detail.status || 'ready'}
              </StatusPill>
            ) : null}
          </div>
          {detailLoading ? (
            <LoadingPlaceholder size="panel" />
          ) : detail ? (
            <>
              <div className="generated-resource-detail-head">
                <div>
                  <h4>{detail.title || '未命名资源'}</h4>
                  <p>{detail.topic || active?.title || '当前课程'}</p>
                </div>
                <div className="generated-resource-detail-meta">
                  <span>{formatResourceTime(detail.createdAt)}</span>
                  {detail.validation?.valid === false ? <small>校验未通过</small> : null}
                </div>
              </div>
              <div className="generated-resource-manifest-strip">
                <div>
                  <span>资源类型</span>
                  <strong>{getGeneratedResourceTypeMeta(detail.resourceType).label}</strong>
                </div>
                <div>
                  <span>状态</span>
                  <strong>{detail.status || 'unknown'}</strong>
                </div>
                <div>
                  <span>主文件</span>
                  <strong>{Object.keys(detail.mainFiles ?? {}).length || 0}</strong>
                </div>
              </div>
              {Object.keys(detail.mainFiles ?? {}).length ? (
                <div className="generated-resource-file-strip">
                  {Object.entries(detail.mainFiles).map(([key, value]) => (
                    <div key={key} className="generated-resource-file-item">
                      <span>{formatMainFileLabel(key)}</span>
                      <strong>{String(value).split('/').pop()}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              {detail.resourceDir ? (
                <div className="generated-resource-path-note">
                  <span>资源目录</span>
                  <code>{detail.resourceDir}</code>
                </div>
              ) : null}
              <GeneratedResourcePreview detail={detail} />
            </>
          ) : (
            <EmptyState>请选择左侧资源查看 Agent 产出内容。</EmptyState>
          )}
        </section>
      </div>

      {recommendationDownloadItems.length ? (
        <div className="generated-resource-related">
          <strong>关联课内材料</strong>
          <MaterialShelf items={recommendationDownloadItems} rows={1} emptyText="暂无关联材料。" />
        </div>
      ) : null}
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

function createEmptyStudyGraphBundle(userId = null, syllabusId = null) {
  const treeId = syllabusId && userId ? `study_tree:${userId}:${syllabusId}` : null;
  return {
    success: true,
    userId,
    syllabusId,
    treeId,
    tree: {
      schema_version: 1,
      tree_id: treeId,
      user_id: userId,
      syllabus_id: syllabusId,
      subject_title: '',
      title: '',
      virtual_root: {
        type: 'tree_root',
        node_id: treeId ? `${treeId}:virtual_root` : 'study_tree_virtual_root',
        title: '',
      },
      nodes: [],
      edges: [],
      summary: {
        learned_node_count: 0,
        mastered_node_count: 0,
        weak_node_count: 0,
        tree_growth: 0,
      },
    },
    features: {
      learned_topics: [],
      weak_topics: [],
      mastered_topics: [],
      recently_grown: [],
      stale_topics: [],
      tree_growth: 0,
      updated_at: 0,
    },
    changes: [],
    toolTrace: [],
    debug: {},
    errorMessage: '',
    errorCode: '',
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
  const [agentTurn, setAgentTurn] = useState(null);
  const [agentToneStyle, setAgentToneStyle] = useState('friendly_pragmatic');
  const [agentAnswerStyle, setAgentAnswerStyle] = useState('normal');
  const [agentConversationHistory, setAgentConversationHistory] = useState([]);
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
  const [studyGraphLoading, setStudyGraphLoading] = useState(false);
  const [studyGraphError, setStudyGraphError] = useState('');
  const [studyGraphBundle, setStudyGraphBundle] = useState(() => createEmptyStudyGraphBundle());
  const [generatedResources, setGeneratedResources] = useState([]);
  const [generatedResourcesLoading, setGeneratedResourcesLoading] = useState(false);
  const [generatedResourcesError, setGeneratedResourcesError] = useState('');
  const [selectedGeneratedResourceId, setSelectedGeneratedResourceId] = useState('');
  const [generatedResourceDetail, setGeneratedResourceDetail] = useState(null);
  const [generatedResourceDetailLoading, setGeneratedResourceDetailLoading] = useState(false);
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
  const resourceGenerationDisabled = isBooting || !active;
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
    setStudyGraphError('');
    setStudyGraphBundle(createEmptyStudyGraphBundle(getCurrentUserId(), activeId));
    setGeneratedResources([]);
    setGeneratedResourcesError('');
    setSelectedGeneratedResourceId('');
    setGeneratedResourceDetail(null);
    setAgentTurn(null);
    setAgentConversationHistory([]);
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

  useEffect(() => {
    let cancelled = false;

    async function loadStudyGraph() {
      if (!active?.syllabusId || isBooting) {
        return;
      }

      setStudyGraphLoading(true);
      setStudyGraphError('');

      try {
        const response = await getStudyGraph({
          syllabusId: active.syllabusId,
        });

        if (cancelled) {
          return;
        }

        if (!response.success) {
          throw new Error(response.errorMessage || '个人知识树加载失败');
        }

        setStudyGraphBundle(response);
      } catch (loadError) {
        if (!cancelled) {
          setStudyGraphError(loadError instanceof Error ? loadError.message : '个人知识树加载失败');
          setStudyGraphBundle(createEmptyStudyGraphBundle(getCurrentUserId(), active.syllabusId));
        }
      } finally {
        if (!cancelled) {
          setStudyGraphLoading(false);
        }
      }
    }

    void loadStudyGraph();

    return () => {
      cancelled = true;
    };
  }, [active?.syllabusId, isBooting]);

  useEffect(() => {
    let cancelled = false;

    async function loadGeneratedResources() {
      if (!active?.syllabusId || isBooting) {
        return;
      }

      setGeneratedResourcesLoading(true);
      setGeneratedResourcesError('');

      try {
        const response = await listGeneratedResources({
          syllabusId: active.syllabusId,
          limit: 12,
        });

        if (cancelled) {
          return;
        }

        if (!response.success) {
          throw new Error(response.errorMessage || '资源列表加载失败');
        }

        setGeneratedResources(response.materials);
        setSelectedGeneratedResourceId((current) => current || response.materials[0]?.resourceId || '');
      } catch (loadError) {
        if (!cancelled) {
          setGeneratedResources([]);
          setGeneratedResourcesError(loadError instanceof Error ? loadError.message : '资源列表加载失败');
        }
      } finally {
        if (!cancelled) {
          setGeneratedResourcesLoading(false);
        }
      }
    }

    void loadGeneratedResources();

    return () => {
      cancelled = true;
    };
  }, [active?.syllabusId, isBooting]);

  useEffect(() => {
    let cancelled = false;

    async function loadGeneratedResourceDetail() {
      if (!selectedGeneratedResourceId) {
        setGeneratedResourceDetail(null);
        return;
      }

      setGeneratedResourceDetailLoading(true);

      try {
        const response = await getGeneratedResourceDetail({
          resourceId: selectedGeneratedResourceId,
        });

        if (cancelled) {
          return;
        }

        if (!response.success) {
          throw new Error(response.errorMessage || '资源详情加载失败');
        }

        setGeneratedResourceDetail(response.material);
      } catch {
        if (!cancelled) {
          setGeneratedResourceDetail(null);
        }
      } finally {
        if (!cancelled) {
          setGeneratedResourceDetailLoading(false);
        }
      }
    }

    void loadGeneratedResourceDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedGeneratedResourceId]);

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
    setAgentTurn(null);
  };

  const recommendationItems = questionAsked
    ? ((active?.recommendedMaterials?.length ? active.recommendedMaterials : active?.defaultRecommendations) ?? [])
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

  const refreshStudyGraphBundle = async () => {
    if (!active?.syllabusId) {
      return;
    }

    const response = await getStudyGraph({
      syllabusId: active.syllabusId,
    });

    if (!response.success) {
      throw new Error(response.errorMessage || '个人知识树加载失败');
    }

    setStudyGraphBundle(response);
  };

  const handleRefreshGeneratedResources = async () => {
    if (!active?.syllabusId) {
      return;
    }

    setGeneratedResourcesLoading(true);
    setGeneratedResourcesError('');

    try {
      const response = await listGeneratedResources({
        syllabusId: active.syllabusId,
        limit: 12,
      });

      if (!response.success) {
        throw new Error(response.errorMessage || '资源列表加载失败');
      }

      setGeneratedResources(response.materials);
      setSelectedGeneratedResourceId((current) => (
        response.materials.some((item) => item.resourceId === current)
          ? current
          : (response.materials[0]?.resourceId || '')
      ));
    } catch (actionError) {
      setGeneratedResources([]);
      setGeneratedResourcesError(actionError instanceof Error ? actionError.message : '资源列表加载失败');
    } finally {
      setGeneratedResourcesLoading(false);
    }
  };

  const runAgentTurn = async (payload = {}) => {
    if (!active?.syllabusId) {
      return null;
    }

    const outgoingMessage = String(payload.message ?? payload.question ?? questionInput).trim();
    if (!outgoingMessage) {
      return null;
    }

    setAskBusy(true);
    setError('');

    try {
      const response = await askQuestion({
        syllabusId: active.syllabusId,
        message: outgoingMessage,
        question: payload.question ?? outgoingMessage,
        intent: payload.intent ?? '',
        autoAccept: payload.autoAccept ?? false,
        candidateIndex: payload.candidateIndex ?? null,
        recommendationResult: payload.recommendationResult ?? null,
        resourceTypes: payload.resourceTypes ?? [],
        toneStyle: payload.toneStyle ?? agentToneStyle,
        answerStyle: payload.answerStyle ?? agentAnswerStyle,
        messages: payload.messages ?? agentConversationHistory,
        context: payload.context ?? {},
      });

      if (!response?.success) {
        throw new Error(response?.errorMessage || '提问失败');
      }

      const nextAnswer = response.answer || '本轮没有返回可展示的答复。';

      setQuestionAsked(true);
      setAnswer(nextAnswer);
      setAgentTurn(response);
      setAgentConversationHistory((current) => {
        const next = [...current, { role: 'user', content: outgoingMessage }];
        if (nextAnswer) {
          next.push({ role: 'assistant', content: nextAnswer });
        }
        return next.slice(-6);
      });

      if (response.recommendation?.candidates?.length || response.recommendation?.bestPath) {
        setRecommendationResult(response.recommendation);
        setActiveRecommendationPathKey(getPathKey(response.recommendation.bestPath?.path ?? response.recommendation.candidates[0]?.path ?? []));
      }

      if (response.generatedResources?.length) {
        await handleRefreshGeneratedResources();
      }

      if (response.intent === 'record_learning_feedback' || response.intent === 'skip_current_step') {
        await refreshStudyGraphBundle();
      }

      if (response.recommendedMaterials?.length) {
        patchActive((item) => {
          item.recommendedMaterials = response.recommendedMaterials;
          return item;
        });
      }

      if (payload.clearInput !== false) {
        setQuestionInput('');
      }

      return response;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '提问失败');
      return null;
    } finally {
      setAskBusy(false);
    }
  };

  const canAcceptRecommendedPath = agentTurn?.suggestedNextAction === 'wait_user_acceptance'
    && (agentTurn?.recommendation?.candidates?.length ?? 0) > 0;
  const canGenerateCurrentStepResource = agentTurn?.suggestedNextAction === 'generate_current_step_resource';

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
                <span>已生成资源</span>
                <strong>{generatedResources.length}</strong>
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
              learningLabel={false}
            />
          </div>

          {active ? (
            <div className="student-dashboard-badges">
              {questionAsked ? <StatusPill tone="success">答疑结果已更新</StatusPill> : null}
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
                  <p>围绕当前课程整理当前进度、推荐状态和提问入口。</p>
                </div>
              </div>

              <div className="student-identity-facts">
                <div className="student-identity-fact-card">
                  <span>课程状态</span>
                  <strong>{active?.isLearning ? '学习中' : '待开始'}</strong>
                </div>
                <div className="student-identity-fact-card">
                  <span>当前周次</span>
                  <strong>{currentWeekIndex ? `第${currentWeekIndex}周` : '未开始'}</strong>
                </div>
              </div>

              <section className="student-sidebar-question">
                <div className="student-surface-head">
                  <div className="student-surface-head-copy">
                    <p className="student-section-kicker">Question</p>
                    <h3>提问</h3>
                    <p className="student-section-subcopy">系统会结合当前上下文，判断你是在提问、要推荐路径，还是要继续当前学习。</p>
                  </div>
                </div>
                <label className="field">
                  <span>问题</span>
                  <textarea
                    rows="4"
                    value={questionInput}
                    placeholder="例如：ETL 在这里具体负责什么？ / 推荐一条学习路径 / 继续当前学习"
                    onChange={(event) => setQuestionInput(event.target.value)}
                  />
                </label>
                <div className="agent-control-grid">
                  <label className="field">
                    <span>回答语气</span>
                    <select
                      className="select-field"
                      value={agentToneStyle}
                      onChange={(event) => setAgentToneStyle(event.target.value)}
                    >
                      {AGENT_TONE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>回答风格</span>
                    <select
                      className="select-field"
                      value={agentAnswerStyle}
                      onChange={(event) => setAgentAnswerStyle(event.target.value)}
                    >
                      {AGENT_ANSWER_STYLE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="tile-actions">
                  <Button
                    variant="primary"
                    className="button-compact"
                    disabled={askBusy || !questionInput.trim()}
                    onClick={() => {
                      void runAgentTurn({ clearInput: true });
                    }}
                  >
                    {askBusy ? '处理中...' : '提问'}
                  </Button>
                  {canAcceptRecommendedPath ? (
                    <Button
                      variant="secondary"
                      className="button-compact"
                      disabled={askBusy}
                      onClick={() => {
                        void runAgentTurn({
                          message: '确认采纳当前推荐路径',
                          intent: 'accept_recommendation',
                          autoAccept: true,
                          candidateIndex: 0,
                          recommendationResult: agentTurn.recommendation,
                          clearInput: false,
                        });
                      }}
                    >
                      采纳路径
                    </Button>
                  ) : null}
                  {canGenerateCurrentStepResource ? (
                    <Button
                      variant="secondary"
                      className="button-compact"
                      disabled={askBusy}
                      onClick={() => {
                        void runAgentTurn({
                          message: '继续当前学习并生成资源',
                          intent: 'generate_current_step_resource',
                          clearInput: false,
                        });
                      }}
                    >
                      生成资源
                    </Button>
                  ) : null}
                </div>
              </section>
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
                      <div className="student-identity-scoreband student-profile-summary-strip">
                        <div className="student-identity-score">
                          <span>画像总分</span>
                          <div className="student-identity-score-row">
                            <strong>{profileScore}</strong>
                            <small>/100</small>
                          </div>
                        </div>
                        <div className="student-identity-level">
                          <span>掌握等级</span>
                          <strong
                            className={[
                              'student-identity-level-value',
                              getMasteryLevelClassName(learningProfile.knowledge_mastery?.overall_level),
                            ].join(' ')}
                          >
                            {formatMasteryLevel(learningProfile.knowledge_mastery?.overall_level)}
                          </strong>
                        </div>
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

                <section className="student-surface student-surface-study-graph">
                  <div className="student-surface-head">
                    <div className="student-surface-head-copy">
                      <p className="student-section-kicker">Study Graph</p>
                      <h3>个人知识树</h3>
                      <p className="student-section-subcopy">按当前课程下的真实成长树，查看知识节点之间的掌握关系与演化状态。</p>
                    </div>
                    <div className="tile-head-controls">
                      <Button
                        variant="primary"
                        className="button-compact"
                        disabled={studyGraphLoading || !active?.syllabusId}
                        onClick={async () => {
                          if (!active?.syllabusId) {
                            return;
                          }

                          setStudyGraphLoading(true);
                          setStudyGraphError('');

                          try {
                            const response = await getStudyGraph({
                              syllabusId: active.syllabusId,
                            });

                            if (!response.success) {
                              throw new Error(response.errorMessage || '个人知识树加载失败');
                            }

                            setStudyGraphBundle(response);
                          } catch (actionError) {
                            setStudyGraphError(actionError instanceof Error ? actionError.message : '个人知识树加载失败');
                          } finally {
                            setStudyGraphLoading(false);
                          }
                        }}
                      >
                        {studyGraphLoading ? '刷新中...' : '刷新'}
                      </Button>
                    </div>
                  </div>
                  {isStudentLoading || studyGraphLoading ? (
                    <LoadingPlaceholder size="panel" />
                  ) : (
                    <DisabledBlock disabled={disabled} message="请先选择学习后查看个人知识树">
                      {studyGraphError ? (
                        <EmptyState>{studyGraphError}</EmptyState>
                      ) : (studyGraphBundle?.tree?.nodes?.length ?? 0) === 0 ? (
                        <EmptyState>当前用户还没有生成个人知识树节点。</EmptyState>
                      ) : (
                        <StudyGraphOverlay
                          inline
                          bundle={studyGraphBundle}
                          height={640}
                        />
                      )}
                    </DisabledBlock>
                  )}
                </section>

                <div className={['student-dialog-grid', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
                  <section className="student-surface student-surface-qa">
                    <div className="student-surface-head">
                      <div className="student-surface-head-copy">
                        <p className="student-section-kicker">Question</p>
                        <h3>提问</h3>
                        <p className="student-section-subcopy">系统会结合当前上下文，判断你是在提问、要推荐路径，还是要继续当前学习。</p>
                      </div>
                      <div className="tile-head-controls">
                        <Button variant="ghost" onClick={() => setIsAnswerExpanded((current) => !current)}>
                          {isAnswerExpanded ? '收起' : '展开回答'}
                        </Button>
                      </div>
                    </div>
                    {isStudentLoading ? (
                      <LoadingPlaceholder size="answer" />
                    ) : (
                      <DisabledBlock disabled={disabled} message="请先选择学习">
                        <div className={['question-grid', 'question-grid-answer-only', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
                          <section className={['response-panel', 'response-panel-answer', isAnswerExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}>
                            <strong className="response-title">回答</strong>
                            {agentTurn ? (
                              <div className="agent-response-meta">
                                <StatusPill tone="success">{formatAgentIntentLabel(agentTurn.intent)}</StatusPill>
                                {agentTurn.answerPayload?.questionType ? (
                                  <StatusPill tone="neutral">{formatAgentQuestionTypeLabel(agentTurn.answerPayload.questionType)}</StatusPill>
                                ) : null}
                                {agentTurn.suggestedNextAction ? (
                                  <StatusPill tone="warning">{formatAgentActionLabel(agentTurn.suggestedNextAction)}</StatusPill>
                                ) : null}
                                <StatusPill tone="neutral">{formatAgentToneLabel(agentTurn.answerPayload?.tone?.tone_style ?? agentToneStyle)}</StatusPill>
                                <StatusPill tone="neutral">{formatAgentAnswerStyleLabel(agentTurn.answerPayload?.tone?.answer_style ?? agentAnswerStyle)}</StatusPill>
                              </div>
                            ) : null}
                            <p className={['response-copy', isAnswerExpanded ? 'is-expanded' : 'is-condensed'].filter(Boolean).join(' ')}>
                              {answer || '尚未提问。'}
                            </p>
                            {agentTurn?.answerPayload?.keyPoints?.length ? (
                              <div className="agent-response-block">
                                <strong>回答要点</strong>
                                <div className="agent-response-list">
                                  {agentTurn.answerPayload.keyPoints.map((item) => <span key={item}>{item}</span>)}
                                </div>
                              </div>
                            ) : null}
                            {agentTurn?.answerPayload?.evidenceUsed?.length ? (
                              <div className="agent-response-block">
                                <strong>证据摘要</strong>
                                <div className="agent-response-list">
                                  {agentTurn.answerPayload.evidenceUsed.map((item, index) => (
                                    <span key={`${item?.title ?? 'evidence'}-${index + 1}`}>
                                      {item?.title ?? '资料'}{item?.relevance ? ` · ${item.relevance}` : ''}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {agentTurn?.toolTrace?.length ? (
                              <div className="agent-response-block">
                                <strong>Agent 处理阶段</strong>
                                <div className="agent-response-list">
                                  {agentTurn.toolTrace.map((item) => <span key={item}>{item}</span>)}
                                </div>
                              </div>
                            ) : null}
                            {(agentTurn?.generatedResources?.length ?? 0) > 0 ? (
                              <div className="agent-response-block">
                                <strong>本轮已生成资源</strong>
                                <div className="agent-response-list">
                                  {agentTurn.generatedResources.map((item) => (
                                    <span key={item.resourceId}>{item.title || item.topic || item.resourceType}</span>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </section>
                        </div>
                      </DisabledBlock>
                    )}
                  </section>

                  <section className="student-surface student-surface-materials">
                    <div className="student-surface-head">
                      <div className="student-surface-head-copy">
                        <p className="student-section-kicker">Generation</p>
                        <h3>资源生成</h3>
                        <p className="student-section-subcopy">这里只展示 Agent 已经产出的学习资源。</p>
                      </div>
                      <Button
                        variant="primary"
                        className="button-compact"
                        disabled={generatedResourcesLoading || !active?.syllabusId}
                        onClick={handleRefreshGeneratedResources}
                      >
                        {generatedResourcesLoading ? '刷新中...' : '刷新'}
                      </Button>
                    </div>
                    {isStudentLoading ? (
                      <LoadingPlaceholder size="shelf" />
                    ) : (
                      <DisabledBlock disabled={resourceGenerationDisabled} message="请先选择课程后查看 Agent 产出资源">
                        {generatedResourcesError ? <EmptyState>{generatedResourcesError}</EmptyState> : null}
                        <GeneratedResourceWorkbench
                          active={active}
                          loading={generatedResourcesLoading}
                          resources={generatedResources}
                          selectedResourceId={selectedGeneratedResourceId}
                          onSelectResource={setSelectedGeneratedResourceId}
                          detail={generatedResourceDetail}
                          detailLoading={generatedResourceDetailLoading}
                          recommendationDownloadItems={recommendationDownloadItems}
                        />
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
