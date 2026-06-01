import { USE_MOCK_API, apiPost } from './client';
import { requireUserId } from './session';

const TOPIC_PATTERNS = [
  ['HDFS', /HDFS/i],
  ['Hadoop', /Hadoop/i],
  ['HBase', /HBase/i],
  ['MapReduce', /MapReduce/i],
  ['Spark', /\bSpark\b/i],
  ['ETL', /\bETL\b|抽取[、，]?转换[、，]?装载/i],
  ['NoSQL', /NoSQL|非关系型数据库/i],
  ['Apriori', /Apriori/i],
  ['关联规则', /关联规则/i],
  ['数据建模', /数据建模/i],
  ['特征选择', /特征选择/i],
  ['特征提取', /特征提取/i],
  ['可视化', /可视化/i],
  ['隐私保护', /隐私保护/i],
  ['网络安全', /网络安全/i],
  ['行业应用', /行业应用|应用场景/i],
  ['数据获取', /感知与获取|数据获取/i],
  ['多源异构', /多源|异构/i],
  ['大数据', /大数据/i],
];

function parseRecommendationResponse(response) {
  return {
    success: Boolean(response?.success),
    graph: {
      nodes: Array.isArray(response?.graph?.nodes) ? response.graph.nodes : [],
      edges: Array.isArray(response?.graph?.edges) ? response.graph.edges : [],
    },
    candidates: Array.isArray(response?.candidates) ? response.candidates : [],
    selected: Array.isArray(response?.selected) ? response.selected : [],
    bestPath: response?.best_path ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
    meta: response?.meta ?? null,
  };
}

function createMockEmptyRecommendation() {
  return {
    success: true,
    graph: { nodes: [], edges: [] },
    candidates: [],
    selected: [],
    best_path: null,
    error_message: '',
    error_code: '',
  };
}

function buildPathEdges(path = []) {
  return path.slice(0, -1).map((nodeId, index) => ({
    edge_id: `${nodeId}->${path[index + 1]}`,
    source: nodeId,
    target: path[index + 1],
  }));
}

function getImportanceScore(importance) {
  if (importance === 'high') {
    return 3;
  }
  if (importance === 'medium') {
    return 2;
  }
  return 1;
}

function getWeakWeeks(learningProfile) {
  const weeks = learningProfile?.knowledge_mastery?.weak_weeks;
  if (!Array.isArray(weeks)) {
    return [];
  }

  return weeks
    .map((week) => Number(week))
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((left, right) => left - right);
}

function extractCourseRootLabel(syllabus = {}, syllabusTitle = '') {
  const rawTitle = String(syllabus?.title ?? syllabusTitle ?? '').trim();

  if (rawTitle.includes('大数据')) {
    return '大数据';
  }
  if (!rawTitle) {
    return '当前课程';
  }

  const normalized = rawTitle.replace(/学习成长树|课程导论|课程|概论/g, '').trim();
  return (normalized || rawTitle).slice(0, 6);
}

function normalizePeriods(periods = []) {
  if (!Array.isArray(periods)) {
    return [];
  }

  return periods
    .map((period) => ({
      ...period,
      weekIndex: Number(period?.week_index ?? period?.weekIndex ?? 0),
    }))
    .filter((period) => Number.isFinite(period.weekIndex) && period.weekIndex > 0)
    .sort((left, right) => left.weekIndex - right.weekIndex);
}

function extractTopicLabels(period = {}) {
  const text = [period?.content, period?.enhanced_content, period?.original_content]
    .filter(Boolean)
    .join(' ');
  const labels = [];

  TOPIC_PATTERNS.forEach(([label, pattern]) => {
    if (pattern.test(text) && !labels.includes(label)) {
      labels.push(label);
    }
  });

  if (labels.length) {
    return labels.slice(0, 3);
  }

  const rawText = String(period?.content ?? period?.original_content ?? '').trim();
  if (!rawText) {
    return [];
  }

  const fallbackLabel = rawText.split('：').pop()?.split(/[；;，,]/)[0]?.trim() ?? rawText;
  return fallbackLabel ? [fallbackLabel.slice(0, 10)] : [];
}

function selectFocusPeriods(periods = [], weakWeeks = []) {
  const periodMap = new Map(periods.map((period) => [period.weekIndex, period]));

  if (weakWeeks.length) {
    const selectedWeakPeriods = weakWeeks
      .map((week) => periodMap.get(week))
      .filter(Boolean)
      .sort((left, right) => (
        getImportanceScore(right.importance) - getImportanceScore(left.importance)
        || left.weekIndex - right.weekIndex
      ))
      .slice(0, 3)
      .sort((left, right) => left.weekIndex - right.weekIndex);

    if (selectedWeakPeriods.length) {
      return selectedWeakPeriods;
    }
  }

  const importantPeriods = periods
    .filter((period) => getImportanceScore(period.importance) >= 2)
    .slice(0, 3);

  if (importantPeriods.length) {
    return importantPeriods;
  }

  return periods.slice(0, 3);
}

function buildTreeFromBlueprint({ rootLabel, pathLabels, extras = [], reason }) {
  const nodes = [];
  const edges = [];
  const addNode = (id, title, prerequisites = []) => {
    nodes.push({
      id,
      title,
      difficulty: 1,
      learning_time_est: 1,
      outcomes: [],
      prerequisites,
    });
  };

  addNode('root', rootLabel, []);

  const path = ['root'];
  let parentId = 'root';

  pathLabels.forEach((label, index) => {
    const nodeId = `path_${index + 1}`;
    addNode(nodeId, label, [parentId]);
    edges.push({
      edge_id: `${parentId}->${nodeId}`,
      source: parentId,
      target: nodeId,
      type: 'prerequisite',
    });
    path.push(nodeId);
    parentId = nodeId;
  });

  extras.forEach((extra, index) => {
    const parentIndex = Number.isFinite(extra.parentIndex)
      ? Math.max(0, Math.min(path.length - 1, extra.parentIndex))
      : 0;
    const prerequisite = path[parentIndex] ?? 'root';
    const nodeId = `extra_${index + 1}`;

    addNode(nodeId, extra.label, [prerequisite]);
    edges.push({
      edge_id: `${prerequisite}->${nodeId}`,
      source: prerequisite,
      target: nodeId,
      type: 'prerequisite',
    });
  });

  const candidate = {
    path,
    path_edges: buildPathEdges(path),
    selected: true,
    rank: 1,
  };

  return {
    success: true,
    graph: { nodes, edges },
    candidates: [candidate],
    selected: [{ ...candidate }],
    bestPath: { path, selected: true },
    errorMessage: '',
    errorCode: '',
    meta: {
      source: 'frontend_grounded_fallback',
      isFallback: true,
      reason,
    },
  };
}

function buildBigDataBlueprint(periods = [], weakWeeks = [], syllabus = {}, syllabusTitle = '') {
  const courseRoot = extractCourseRootLabel(syllabus, syllabusTitle);
  const availableWeeks = new Set(periods.map((period) => period.weekIndex));
  const allText = periods
    .map((period) => [period?.content, period?.enhanced_content, period?.original_content].filter(Boolean).join(' '))
    .join(' ');
  const periodMap = new Map(periods.map((period) => [period.weekIndex, period]));
  const scopedTitle = courseRoot === '大数据' ? courseRoot : `${courseRoot}分析`;
  const blueprints = [
    {
      id: 'storage',
      weeks: [5, 6, 7],
      patterns: [/HDFS/i, /HBase/i, /Hadoop/i, /NoSQL/i],
      rootLabel: courseRoot,
      pathLabels: ['HDFS', 'HBase'],
      extras: [
        { label: 'Hadoop', parentIndex: 1 },
        { label: 'NoSQL', parentIndex: 2 },
      ],
      reason: '依据当前课程大纲，第5-6周围绕 HDFS 与 HBase 展开，适合作为当前优先补强的主链路。',
    },
    {
      id: 'analysis',
      weeks: [8, 9, 10],
      patterns: [/数据建模/i, /关联规则/i, /Apriori/i, /特征选择/i],
      rootLabel: scopedTitle,
      pathLabels: ['数据建模', '关联规则', 'Apriori'],
      extras: [
        { label: '特征选择', parentIndex: 1 },
      ],
      reason: '依据当前课程大纲，第8-10周围绕数据建模与关联规则展开，建议沿主链路逐步补齐。',
    },
    {
      id: 'compute',
      weeks: [11, 12, 13],
      patterns: [/MapReduce/i, /Spark/i, /可视化/i, /GPU/i, /TPU/i, /FPGA/i],
      rootLabel: courseRoot === '大数据' ? '大数据处理' : courseRoot,
      pathLabels: ['MapReduce', 'Spark'],
      extras: [
        { label: '可视化', parentIndex: 0 },
        { label: 'GPU/TPU', parentIndex: 2 },
      ],
      reason: '依据当前课程大纲，第12周的 MapReduce 与 Spark 是处理架构部分的核心主线。',
    },
    {
      id: 'acquire',
      weeks: [3, 4],
      patterns: [/感知与获取/i, /ETL/i, /多源/i, /异构/i],
      rootLabel: courseRoot,
      pathLabels: ['数据获取', 'ETL'],
      extras: [
        { label: '多源异构', parentIndex: 1 },
      ],
      reason: '依据当前课程大纲，第3-4周聚焦数据获取与 ETL，适合作为当前优先补强的起步链路。',
    },
    {
      id: 'security',
      weeks: [14, 15, 16],
      patterns: [/隐私保护/i, /网络安全/i, /行业应用/i],
      rootLabel: courseRoot === '大数据' ? '大数据安全' : courseRoot,
      pathLabels: ['隐私保护', '行业应用'],
      extras: [
        { label: '网络安全', parentIndex: 1 },
      ],
      reason: '依据当前课程大纲，后段内容聚焦隐私保护与行业应用，可作为后续延展链路。',
    },
  ];

  const candidates = blueprints
    .filter((blueprint) => (
      blueprint.weeks.some((week) => availableWeeks.has(week))
      || blueprint.patterns.some((pattern) => pattern.test(allText))
    ))
    .map((blueprint) => ({
      blueprint,
      overlap: blueprint.weeks.filter((week) => weakWeeks.includes(week)).length,
      coverage: blueprint.weeks.filter((week) => availableWeeks.has(week)).length,
      emphasis: blueprint.weeks.reduce((sum, week) => sum + getImportanceScore(periodMap.get(week)?.importance), 0),
    }))
    .sort((left, right) => (
      right.overlap - left.overlap
      || right.emphasis - left.emphasis
      || right.coverage - left.coverage
    ));

  return candidates[0]?.blueprint ?? null;
}

function buildGenericFallbackRecommendation(syllabus = {}, learningProfile = {}, syllabusTitle = '') {
  const periods = normalizePeriods(syllabus?.period);
  if (!periods.length) {
    return null;
  }

  const weakWeeks = getWeakWeeks(learningProfile);
  const focusPeriods = selectFocusPeriods(periods, weakWeeks);
  const primaryLabels = [];
  const extraLabels = [];

  focusPeriods.forEach((period) => {
    const labels = extractTopicLabels(period);

    if (labels[0] && !primaryLabels.includes(labels[0])) {
      primaryLabels.push(labels[0]);
    }

    labels.slice(1).forEach((label) => {
      if (!extraLabels.includes(label)) {
        extraLabels.push(label);
      }
    });
  });

  const rootLabel = extractCourseRootLabel(syllabus, syllabusTitle);
  const pathLabels = primaryLabels
    .filter((label) => label && label !== rootLabel)
    .slice(0, 3);

  if (!pathLabels.length) {
    pathLabels.push('核心知识');
  }

  const extras = extraLabels
    .filter((label) => !pathLabels.includes(label))
    .slice(0, 2)
    .map((label, index) => ({
      label,
      parentIndex: Math.min(index + 1, pathLabels.length),
    }));

  return buildTreeFromBlueprint({
    rootLabel,
    pathLabels,
    extras,
    reason: `依据当前课程大纲，系统先串联 ${[rootLabel, ...pathLabels].join(' -> ')} 这条较短链路，便于你优先补核心节点。`,
  });
}

function createGroundedFallbackRecommendation(payload = {}) {
  const syllabus = payload.personalSyllabus ?? payload.personal_syllabus ?? null;
  const learningProfile = payload.learningProfile ?? payload.learning_profile ?? null;
  const syllabusTitle = payload.syllabusTitle ?? payload.syllabus_title ?? '';
  const periods = normalizePeriods(syllabus?.period);

  if (!periods.length) {
    return null;
  }

  const blueprint = buildBigDataBlueprint(periods, getWeakWeeks(learningProfile), syllabus, syllabusTitle);
  if (blueprint) {
    return buildTreeFromBlueprint(blueprint);
  }

  return buildGenericFallbackRecommendation(syllabus, learningProfile, syllabusTitle);
}

function isSampleFallbackRecommendation(parsed) {
  const nodes = parsed?.graph?.nodes ?? [];

  if (!nodes.length) {
    return false;
  }

  return nodes.length === 5 && nodes.every((node, index) => String(node?.id ?? '') === `n${index + 1}`);
}

function shouldUseGroundedFallback(parsed) {
  if (!parsed?.success) {
    return true;
  }

  if (isSampleFallbackRecommendation(parsed)) {
    return true;
  }

  const nodes = parsed?.graph?.nodes ?? [];
  const candidates = parsed?.candidates ?? [];
  const hasCandidatePath = candidates.some((candidate) => Array.isArray(candidate?.path) && candidate.path.length);
  const hasBestPath = Array.isArray(parsed?.bestPath?.path) && parsed.bestPath.path.length;

  if (!nodes.length) {
    return true;
  }

  return !hasCandidatePath && !hasBestPath;
}

export async function getPersonalRecommendationRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });

  if (USE_MOCK_API) {
    return createMockEmptyRecommendation();
  }

  return apiPost('/api/personal_recommendation', {
    user_id: userId,
    syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
    goals: payload.goals,
    L_max: payload.LMax ?? payload.L_max,
    T_max: payload.TMax ?? payload.T_max,
    K: payload.K,
    beam_width: payload.beamWidth ?? payload.beam_width,
  });
}

export async function getPersonalRecommendation(payload = {}) {
  try {
    const parsed = parseRecommendationResponse(await getPersonalRecommendationRaw(payload));

    if (shouldUseGroundedFallback(parsed)) {
      return createGroundedFallbackRecommendation(payload) ?? parsed;
    }

    return parsed;
  } catch (error) {
    const fallback = createGroundedFallbackRecommendation(payload);
    if (fallback) {
      return fallback;
    }
    throw error;
  }
}

export { parseRecommendationResponse };
